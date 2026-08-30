/****************************************************************************
ISC License

Copyright (c) 2025 Jean-Pierre Benoit

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
const debug = require("debug")("signalk:signalk-engine-state");

*****************************************************************************
Signal K server plugin to log performance data to csv files.

Features:
- Basic logging
- Configurable log directory
- Splitting per hour

TODO:

*****************************************************************************/
const debug = require("debug")("signalk:signalk-perf-logger");
const util = require("util");
const _ = require('lodash')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

module.exports = function(app) {
    var plugin = {};
    var logDir = ""
    var logFileName = "data_log.json"
    var timerRotationId
    var timerId
    var logenable = false
    var flushEnabled = false
    var zipEnabled = true
    var logStream = null
    var sails
    var enginestate
    var period
    var logRotationInterval

    var lastSkTimestamp = 0

    plugin.id = "sk-perf-logger"
    plugin.name = "Performance data Logger"
    plugin.description = "Log sailboat performance data to csv files"

    plugin.schema = {
	type: "object",
	title: "Sailboat performance data log",
	description: "Log sailboat parameters to csv files",
	properties: {
	    logenable: {
		type: 'boolean',
		title: 'Enable logging',
		default: false,
	    },
	    main: {
		type: 'boolean',
		title: 'Main sail',
		default: true,
	    },
	    jib: {
		type: 'boolean',
		title: 'Jib',
		default: true,
	    },
	    screacher: {
		type: 'boolean',
		title: 'Screacher',
		default: false,
	    },
	    spinnaker: {
		type: 'boolean',
		title: 'Spinnaker',
		default: false,
	    },
	    enginestate: {
		type: 'string',
		title: 'Engine state',
		default: 'started',
		enum: ['started', 'stopped'],
	    },
	    logdir: {
		type: 'string',
		title: 'Log files directory',
            default: './sk-perf-data'
	    },
	    logrotationinterval: {
		type: 'number',
		title: 'Log rotation interval (s). Value of zero disables log rotation.',
            default: 3600
	    },
	    period: {
		type: 'number',
		title: 'Logging period (s)',
		default: 300
	    },
	    flush: {
		type: 'boolean',
		title: 'Flush after each write',
		default: false
	    },
	    zip: {
		type: 'boolean',
		title: 'Compress rotated log files',
		default: true
	    }
	}
    }

    plugin.start = function (options) {

	app.debug('plugin.start called')

	if (typeof options.logdir === 'undefined') {
	    app.setProviderStatus('Log directory not defined, plugin disabled')
	    return
	}
	const rawDir = options.logdir.startsWith('~') ? options.logdir.replace('~', require('os').homedir()) : options.logdir
	logDir = path.isAbsolute(rawDir) ? rawDir : path.resolve(app.getDataDirPath(), rawDir)
	logRotationInterval = options.logrotationinterval
	period = options.period
	logenable = options.logenable || false
	flushEnabled = options.flush || false
	zipEnabled = options.zip !== undefined ? options.zip : true
	sails = {
	    main: options.main || true,
	    jib: options.jib || true,
	    screacher: options.screacher || false,
	    spinnaker: options.spinnaker || false
	}
	enginestate=options.enginestate

	app.debug(`logDir=${logDir} period=${period} logenable=${logenable}`)

	if (!fs.existsSync(logDir)) {
	    // attempt creating the log directory
	    try {
		fs.mkdirSync(logDir)
	    } catch (error) {
		app.setProviderStatus(`Unable to create log directory ${logDir}, plugin disabled`)
		return
	    }
	}

	// compress the old leftover logfile, if any
	const logMetaFileName = path.join(logDir, '.current_log_file')
	if (fs.existsSync(logMetaFileName)) {
	    app.debug("meta file exists")
	    const oldLogFile = fs.readFileSync(logMetaFileName).toString()
	    if (fs.existsSync(path.join(logDir, oldLogFile))) {
		if (zipEnabled) compressLogFile(logDir, oldLogFile)
	    }
	}

	// create a new logfile
	rotateLogFile(new Date())

	if (logRotationInterval > 0) {
	    timerRotationId = setInterval(() => { rotateLogFile(new Date(), true) }, logRotationInterval * 1000 )
	}

	app.debug(`starting interval with period=${period}s`)
	timerId = setInterval(() => {
	    //app.debug(`interval tick: logenable=${logenable}`)
	    if (logenable) writeData(sails, enginestate)
	}, period * 1000 )
    }
    
    plugin.registerWithRouter = function (router) {
	router.get('/logenable', (req, res) => {
	    res.json({ logenable })
	})
	router.put('/logenable', (req, res) => {
	    if (typeof req.body.logenable !== 'boolean') {
		return res.status(400).json({ error: 'logenable must be a boolean' })
	    }
	    logenable = req.body.logenable
	    app.debug(`Logging ${logenable ? 'enabled' : 'disabled'} via API, path: ${path.join(logDir, logFileName)}`)
	    res.json({ logenable })
	})
	router.get('/engine', (req, res) => {
	    res.json({ engine: enginestate === 'started' })
	})
	router.put('/engine', (req, res) => {
	    if (typeof req.body.engine !== 'boolean') {
		return res.status(400).json({ error: 'engine must be a boolean' })
	    }
	    const wasOff = enginestate === 'stopped'
	    enginestate = req.body.engine ? 'started' : 'stopped'
	    // engine going from off to on stops recording
	    if (wasOff && enginestate === 'started') {
		logenable = false
		app.debug('Engine started, recording stopped automatically')
	    }
	    app.debug(`Engine state set to ${enginestate} via API`)
	    res.json({ engine: req.body.engine, logenable })
	})
	router.get('/data', (req, res) => {
	    try {
		const val = (p) => {
		    const v = app.getSelfPath(p)
		    return v !== undefined && v !== null ? Number(v) : null
		}
		const kn = (v) => v !== null ? +(v * 1.94384).toFixed(2) : null
		const deg = (v) => v !== null ? +(v * (180 / Math.PI)).toFixed() : null

		// Fall back to performance.velocityMadeGood if specific wind/ground paths are unavailable
		const vmgWRaw = val('performance.velocityMadeGoodWind.value') ?? val('performance.velocityMadeGood.value')
		const vmgGRaw = val('performance.velocityMadeGoodGround.value') ?? val('performance.velocityMadeGood.value')

		res.json({
		    sog: kn(val('navigation.speedOverGround.value')),
		    cog: deg(val('navigation.courseOverGroundTrue.value')),
		    stw: kn(val('navigation.speedThroughWater.value')),
		    aws: kn(val('environment.wind.speedApparent.value')),
		    awa: deg(val('environment.wind.angleApparent.value')),
		    tws: kn(val('environment.wind.speedTrue.value')),
		    twa: deg(val('environment.wind.angleTrueWater.value')),
		    hdg: deg(val('navigation.headingTrue.value')),
		    vmgW: kn(vmgWRaw),
		    vmgG: kn(vmgGRaw),
		    dbk: val('environment.depth.belowKeel.value') !== null ? +Number(val('environment.depth.belowKeel.value') * 3.28084).toFixed(1) : null
		})
	    } catch (err) {
		res.status(500).json({ error: err.message })
	    }
	})
    }

    plugin.stop = function () {

	clearInterval(timerRotationId)
	clearInterval(timerId)

	// close the stream before compressing
	if (logStream) {
	    logStream.end()
	    logStream = null
	}

	// compress the log file
	rotateLogFile(new Date(), true)
    }
    return plugin

    function writeData(sails, state) {

	try {
	    // do not log when engine is running
	    if (enginestate === 'started') {
		app.debug('writeData: engine is running, skipping')
		return
	    }

	    let datetime=app.getSelfPath('navigation.datetime.value')
	    let timestamp=Date.parse(datetime)

	    if (isNaN(timestamp)) {
		app.debug('writeData: no valid datetime, skipping')
		return
	    }

	    // only log if SK time is advancing (data is live or replaying)
	    if (lastSkTimestamp > 0 && (timestamp - lastSkTimestamp) > 0) {

		let longitude=Number(app.getSelfPath('navigation.position.value.longitude')).toFixed(6)
		let latitude=Number(app.getSelfPath('navigation.position.value.latitude')).toFixed(6)
		let sog=(Number(app.getSelfPath('navigation.speedOverGround.value'))*1.94384).toFixed(2)
		let cog=(Number(app.getSelfPath('navigation.courseOverGroundTrue.value'))*(180/Math.PI)).toFixed()
		let stw=(Number(app.getSelfPath('navigation.speedThroughWater.value'))*1.94384).toFixed(2)
		let aws=(Number(app.getSelfPath('environment.wind.speedApparent.value'))*1.94384).toFixed(2)
		let awa=(Number(app.getSelfPath('environment.wind.angleApparent.value'))*(180/Math.PI)).toFixed()
		let tws=(Number(app.getSelfPath('environment.wind.speedTrue.value'))*1.94384).toFixed(2)
		let twa=(Number(app.getSelfPath('environment.wind.angleTrueWater.value'))*(180/Math.PI)).toFixed()
		let hdg=(Number(app.getSelfPath('navigation.headingTrue.value'))*(180/Math.PI)).toFixed()
		let vmgWRaw = app.getSelfPath('performance.velocityMadeGoodWind.value') ?? app.getSelfPath('performance.velocityMadeGood.value')
		let vmgGRaw = app.getSelfPath('performance.velocityMadeGoodGround.value') ?? app.getSelfPath('performance.velocityMadeGood.value')
		let vmgW=(Number(vmgWRaw)*1.94384).toFixed(2)
		let vmgG=(Number(vmgGRaw)*1.94384).toFixed(2)
		let dbk=(Number(app.getSelfPath('environment.depth.belowKeel.value'))*3.28084).toFixed(1)
		let sailStr = [sails.main?'main':'', sails.jib?'jib':'', sails.screacher?'screacher':'', sails.spinnaker?'spinnaker':''].filter(Boolean).join('+')
		row=datetime+","+sailStr+","+longitude+","+latitude+","+sog+","+cog+","+stw+","+aws+","+awa+","+tws+","+twa+","+hdg+","+vmgW+","+vmgG+","+dbk+","+state+"\n"
		if (logStream) {
		    logStream.write(row, () => {
			if (flushEnabled) {
			    fs.fdatasync(logStream.fd, (err) => {
				if (err) app.debug(`flush error: ${err.message}`)
			    })
			}
		    })
		}
		//app.debug(`adding row : ${row}`)

	    }
	    lastSkTimestamp = timestamp

	} catch (err) {
	    console.log(err)
	}
    }

    function compressLogFile(logDir, logFileName) {
	let logPath = path.join(logDir, logFileName)
	const gzip = spawn('gzip', [logPath])
	gzip.on('close', (code) => {
	    if (code !== 0) {
		console.log(`Compressing file ${logPath} failed with exit code ${code}`)
	    }
	})
    }

    function writeHeaders() {
	try {
	    if (logStream) {
		logStream.write(
		    "time,sails,lon,lat,sog,cog,stw,aws,awa,tws,twa,hdg,vmgW,vmgG,dbk,engine\n"
		)
	    }
	} catch (err) {
	    console.log(err)
	}
    }

    function rotateLogFile(time, compressPrevious = false) {
	// close the previous stream
	if (logStream) {
	    logStream.end()
	    logStream = null
	}

	// update the log filename
	const oldLogFileName = logFileName
	logFileName = "perf-data.".concat(time.toISOString().replace(/\:/g,"-")).concat('.log')
	app.debug(`Opening log file: ${path.join(logDir, logFileName)}`)

	// open a new write stream
	logStream = fs.createWriteStream(path.join(logDir, logFileName), { flags: 'a' })

	// write the column headers
	writeHeaders();

	// gzip the old logfile
	if (compressPrevious && zipEnabled) {
	    compressLogFile(logDir, oldLogFileName)
	}

	// keep track of the current log file
	fs.writeFileSync(path.join(logDir, '.current_log_file'), logFileName)
    }
}
