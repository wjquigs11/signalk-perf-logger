const Bacon = require("baconjs");
const debug = require("debug")("signalk:signalk-perf-logger");
const util = require("util");
const _ = require('lodash')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

/*

Signal K server plugin to log performance data to csv files.

Features:
- Basic logging
- Configurable log directory
- Splitting per hour

TODO:

*/

module.exports = function(app) {
    var plugin = {};
    var logDir = ""
    var logFileName = "data_log.json"
    var timerRotationId
    var timerId
    var model
    var sailconfig
    
    plugin.id = "sk-perf-logger"
    plugin.name = "Signal K perf data logger"
    plugin.description = "Log Signal K performance data to csv files."

    plugin.schema = {
	type: "object",
	title: "Performance data logging to csv files",
	description: "Log Signal K performance data into csv files.",
	properties: {
	    logdir: {
		type: 'string',
		title: 'Data log file directory',
            default: '/root/.signalk/sk-perf-data'
	    },
	    logrotationinterval: {
		type: 'number',
		title: 'Log rotation interval (in seconds). Value of zero disables log rotation.',
            default: 3600
	    },
	    context: {
		type: 'string',
		title: 'Subscription context',
            default: 'vessels.self'
	    },
	    period: {
		type: 'number',
		title: 'Logging period',
		default: 300
	    },
	    model: {
		type: 'string',
		title: 'Sailboat model',
		default: 'Muscadet Q',
		enum: ['Muscadet Q', 'Muscadet DL'],
	    },
	    sailconfig: {
		type: 'string',
		title: 'Sail configuration',
		default: 'Intermediate jib + Main',
		enum: ['Genoa + Main', 'Intermediate jib + Main', 'Inter jib + Main one reef', 'Small jib + Main one reef', 'Small jib + Main two reefs'],
	    },
	    enginestate: {
		type: 'string',
		title: 'Engine state',
		default: 'started',
		enum: ['started', 'stopped'],
	    }
	}
    }

    plugin.start = function (options) {

	if (typeof options.logdir === 'undefined') {
	    app.setProviderStatus('Log directory not defined, plugin disabled')
	    return
	}
	logDir = options.logdir
	logRotationInterval = options.logrotationinterval
	context = options.context
	period = options.period
	model = options.model
	sailconfig=options.sailconfig
	enginestate=options.enginestate

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
		compressLogFile(logDir, oldLogFile)
	    }
	}

	// create a new logfile
	rotateLogFile(new Date())

	if (logRotationInterval > 0) {
	    timerRotationId = setInterval(() => { rotateLogFile(new Date(), true) }, logRotationInterval * 1000 )
	}

	timerId = setInterval(() => { writeData(model, sailconfig, enginestate) }, period * 1000 )
    }
    
    plugin.stop = function () {

	clearInterval(timerRotationId)
	clearInterval(timerId)

	// compress the log file
	rotateLogFile(new Date(), true)
    }
    return plugin

    function writeData(model, config, state) {

	try {
	    let tunix=Math.round(+new Date())
	    let datetime=app.getSelfPath('navigation.datetime.value')
	    let timestamp=Date.parse(datetime)

	    if ((tunix-timestamp) < period * 1000) { // only log if age of data < period

		let longitude=Number(app.getSelfPath('navigation.position.value.longitude')).toFixed(6)
		let latitude=Number(app.getSelfPath('navigation.position.value.latitude')).toFixed(6)
		let sog=(Number(app.getSelfPath('navigation.speedOverGround.value'))*1.94384).toFixed(2)
		let cog=(Number(app.getSelfPath('navigation.courseOverGroundTrue.value'))*(180/Math.PI)).toFixed()
		let stw=(Number(app.getSelfPath('navigation.speedThroughWater.value'))*1.94384).toFixed(2)
		let aws=(Number(app.getSelfPath('environment.wind.speedApparent.value'))*1.94384).toFixed(2)
		let awa=(Number(app.getSelfPath('environment.wind.angleApparent.value'))*(180/Math.PI)).toFixed()
		let dbk=(Number(app.getSelfPath('environment.depth.belowKeel.value'))).toFixed(1)
		row=datetime+","+model+","+config+","+longitude+","+latitude+","+sog+","+cog+","+stw+","+aws+","+awa+","+dbk+","+state+"\n"
		fs.appendFile(
		    path.join(logDir, logFileName),
		    row,
		    (err) => {
			if (err) throw err;
		    }
		)
		app.debug(`sk-perf-logger adding row : ${row}`)

	    }

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
	    fs.appendFile(
		path.join(logDir, logFileName),
		"time,model,config,lon,lat,sog,cog,stw,aws,awa,dbk,engine\n", (err) => {
		    if (err) throw err;
		}
	    )
	} catch (err) {
	    console.log(err)
	}
    }

    function rotateLogFile(time, compressPrevious = false) {
	// update the log filename
	const oldLogFileName = logFileName
	logFileName = "perf-data.".concat(time.toISOString().replace(/\:/g,"-")).concat('.log')

	// write the column headers
	writeHeaders();

	// gzip the old logfile
	if (compressPrevious) {
	    compressLogFile(logDir, oldLogFileName)
	}

	// keep track of the current log file
	fs.writeFileSync(path.join(logDir, '.current_log_file'), logFileName)
    }
}
