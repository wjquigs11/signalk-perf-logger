---
inclusion: always
---

# Signal K Plugin Development Reference

Sources:
- https://demo.signalk.org/documentation/_signalk/server-api/Plugin.html
- https://demo.signalk.org/documentation/Developing/Plugins.html
- https://demo.signalk.org/documentation/Developing/Plugins/Configuration.html
- https://demo.signalk.org/documentation/Developing/Plugins/Processing_Data.html
- https://demo.signalk.org/documentation/Developing/Plugins/WebApps.html
- https://demo.signalk.org/documentation/Developing/Plugins/WASM_Plugins.html
- https://demo.signalk.org/documentation/Developing/Plugins/Resource_Providers.html
- https://demo.signalk.org/documentation/Developing/Plugins/Autopilot_Providers.html
- https://demo.signalk.org/documentation/Developing/Plugins/Course_Providers.html
- https://demo.signalk.org/documentation/Developing/Plugins/Weather_Providers.html
- https://demo.signalk.org/documentation/Developing/Plugins/Connection_Backpressure.html
- https://demo.signalk.org/documentation/Developing/Plugins/Publishing_to_The_AppStore.html
- https://demo.signalk.org/documentation/Developing/Plugins/Custom_Renderers_for_the_Data_Browser.html

---

## Plugin Interface

Every Signal K plugin must implement the `Plugin` interface:

```typescript
interface Plugin {
  id: string;
  name: string;
  schema: object | (() => object);
  description?: string;
  enabledByDefault?: boolean;
  getOpenApi?: () => object;
  statusMessage?: () => string | void;
  uiSchema?: object | (() => object);
  start(config: object, restart: (newConfiguration: object) => void): void;
  stop(): void | Promise<void>;
  registerWithRouter?(router: IRouter): void;
  signalKApiRoutes?(router: IRouter): IRouter;
}
```

## Required Properties

### Identification

- `id: string` — Unique identifier for the plugin
- `name: string` — Human-readable name for the plugin

### Configuration

- `schema: object | (() => object)` — JSON Schema defining the plugin's configuration options. Can be a static object or a function returning one.

### Lifecycle

- `start(config: object, restart: (newConfiguration: object) => void): void` — Called when the plugin starts. Receives the current config and a `restart` callback to restart with new config.
- `stop(): void | Promise<void>` — Called when the plugin stops. Can be async.

## Optional Properties

### Configuration

- `enabledByDefault?: boolean` — Whether the plugin is enabled by default
- `uiSchema?: object | (() => object)` — UI schema for customizing the config form rendering

### Other

- `description?: string` — Short description of the plugin
- `getOpenApi?: () => object` — Returns an OpenAPI spec for the plugin's routes
- `statusMessage?: () => string | void` — Returns a status string shown in the admin UI

### REST API

- `registerWithRouter?(router: IRouter): void` — Register custom Express routes (non-Signal K paths)
- `signalKApiRoutes?(router: IRouter): IRouter` — Register routes under the Signal K API path

---

## Getting Started

### Prerequisites
- Signal K server instance (git clone or Docker)
- Node.js v20+ and npm
- SignalK config folder at `$HOME/.signalk`

### Project Structure
```
/my-plugin
  /plugin       # compiled JS
    index.js
  /public       # web UI
    index.html
  /src          # TypeScript source
    index.ts
  package.json
```

### package.json Setup
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "keywords": [
    "signalk-node-server-plugin",
    "signalk-category-ais"
  ],
  "signalk-plugin-enabled-by-default": false,
  "signalk": {
    "appIcon": "./assets/icons/icon-72x72.png",
    "displayName": "My Great WebApp"
  },
  "main": "plugin/index.js"
}
```

### Linking to Signal K Server for Development
```bash
cd my_plugin_src
npm link
cd ~/.signalk
npm link my-signalk-plugin-app
```

### Debugging
```bash
DEBUG=my-signalk-plugin signalk-server
DEBUG=signalk:interfaces:plugins signalk-server
signalk-server --sample-n2k-data   # use synthetic NMEA2000 data
```

---

## Plugin Templates

### JavaScript
```js
module.exports = (app) => {
  const plugin = {
    id: 'my-signalk-plugin',
    name: 'My Great Plugin',
    start: (settings, restartPlugin) => {
      // startup code
    },
    stop: () => {
      // shutdown code
    },
    schema: () => ({
      properties: {
        // config schema here
      }
    })
  }
  return plugin
}
```

### TypeScript
```ts
import { Plugin, ServerAPI } from '@signalk/server-api'

const start = (app: ServerAPI): Plugin => {
  const plugin: Plugin = {
    id: 'my-signalk-plugin',
    name: 'My Great Plugin',
    start: (settings, restartPlugin) => {},
    stop: () => {},
    schema: () => ({ properties: {} })
  }
  return plugin
}
module.exports = start
```

---

## Plugin Configuration

`schema` must return a JSON Schema object:

```js
plugin.schema = {
  type: 'object',
  required: ['some_string'],
  properties: {
    some_string: { type: 'string', title: 'Some string' },
    some_number: { type: 'number', title: 'Some number', default: 60 }
  }
}
```

Config is stored at `$SIGNALK_NODE_CONFIG_DIR/plugin-config-data/<plugin-name>.json`.

### UI Schema
```js
uiSchema['myObject'] = {
  'ui:field': 'collapsible',
  collapse: { field: 'ObjectField', wrapClassName: 'panel-group' }
}
```

### Enable by Default
Add to `package.json`:
```json
"signalk-plugin-enabled-by-default": true
```

---

## Processing Data

### Read Current Value
```js
const value = app.getSelfPath('uuid')
const baseStations = app.getPath('shore.basestations')
```

### Subscribe to Deltas
```js
let unsubscribes = []

plugin.start = (options, restartPlugin) => {
  const localSubscription = {
    context: '*',
    subscribe: [{ path: '*', period: 5000 }]
  }
  app.subscriptionmanager.subscribe(
    localSubscription,
    unsubscribes,
    (err) => app.error('Error:' + err),
    (delta) => delta.updates.forEach((u) => app.debug(u))
  )
}

plugin.stop = () => {
  unsubscribes.forEach((f) => f())
  unsubscribes = []
}
```

Use `announceNewPaths: true` to discover available paths without continuous updates.

### Send Deltas
```js
app.handleMessage(plugin.id, {
  updates: [{
    values: [{ path: 'environment.outside.temperature', value: 20 }]
  }]
}, 'v1')
```

### Send NMEA 2000
```js
app.emit('nmea2000out', '2017-04-15T14:57:58.468Z,0,262384,...')
app.emit('nmea2000JsonOut', { pgn: 130306, 'Wind Speed': speed, 'Wind Angle': angle, Reference: 'Apparent' })

// Wait for provider ready before sending at startup:
app.on('nmea2000OutAvailable', () => { app.emit('nmea2000out', '...') })
```

---

## REST API / Router

```js
plugin.registerWithRouter = (router) => {
  router.get('/preferences', (req, res) => {
    res.status(200).json({ preferences: { color: 'red' } })
  })
}
```
APIs published at `http://{skserver}:3000/plugins/{pluginId}{path}`.

### OpenAPI Definition
```js
const openapi = require('./openApi.json')
plugin.getOpenApi = () => openapi
```

If the plugin API is not rooted at the Signal K API path, include a `servers` property:
```json
"servers": [{ "url": "/myapi/endpoint" }]
```

---

## Resource Provider Plugins

Register as a provider for routes, waypoints, charts, etc:

```ts
import { ResourceProvider } from '@signalk/server-api'

app.registerResourceProvider({
  type: 'routes',
  methods: {
    listResources: (params) => Promise.resolve(resourceList),
    getResource: (id, property?) => Promise.resolve(resource),
    setResource: (id, value) => { throw new Error('Not implemented') },
    deleteResource: (id) => { throw new Error('Not implemented') }
  }
})
```

### Emit Deltas for Resource Changes
```js
app.handleMessage(plugin.id, {
  updates: [{
    values: [{ path: `resources.charts.${chartId}`, value: chartData }]
  }]
}, 2) // v2 - resources should not be in full model cache
```
Use `null` as value for deletions.

---

## Autopilot Provider Plugins

```ts
import { AutopilotProvider } from '@signalk/server-api'

const autopilotProvider: AutopilotProvider = {
  getData: (deviceId) => { ... },
  getState: (deviceId) => { ... },
  setState: (state, deviceId) => { ... },
  getMode: (deviceId) => { ... },
  setMode: (mode, deviceId) => { ... },
  getTarget: (deviceId) => { ... },
  setTarget: (value, deviceId) => { ... },
  adjustTarget: (value, deviceId) => { ... },
  engage: (deviceId) => { ... },
  disengage: (deviceId) => { ... },
  tack: (direction, deviceId) => { ... },
  gybe: (direction, deviceId) => { ... },
  dodge: (value, deviceId) => { ... }
}

plugin.start = (options) => {
  app.registerAutopilotProvider(autopilotProvider, ['pilot1', 'pilot2'])
}
```

### Send Autopilot Updates
```js
app.autopilotUpdate('my-pilot', { target: 1.52789, mode: 'compass' })
```

### Send Autopilot Notifications
```js
app.autopilotUpdate('my-pilot', {
  alarm: {
    path: 'waypointAdvance',
    value: { state: 'alert', method: ['sound'], message: 'Waypoint Advance' }
  }
})
```

---

## Course Provider Plugins

Implement a course provider to populate `/vessels/self/navigation/course/calcValues`:

- `calcMethod`, `crossTrackError`, `bearingTrackTrue`, `bearingTrackMagnetic`
- `estimatedTimeOfArrival`, `distance`, `bearingTrue`, `bearingMagnetic`
- `velocityMadeGood`, `timeToGo`, `targetSpeed`, `previousPoint.distance`

Guidelines:
- Calculate using `/vessels/self/navigation/course` values from the Course API
- Set values to `null` when no destination is set
- Use a worker thread for calculations
- Raise `navigation.course.arrivalCircleEntered` and `navigation.course.perpendicularPassed` notifications

---

## Weather Provider Plugins

```ts
import { WeatherProvider } from '@signalk/server-api'

const weatherProvider: WeatherProvider = {
  name: 'MyWeatherService',
  methods: {
    getObservations: (position, options?) => { return observations },
    getForecasts: (position, type, options?) => { return forecasts },
    getWarnings: () => { throw new Error('Not supported!') }
  }
}

plugin.start = (settings) => {
  app.registerWeatherProvider(weatherProvider)
}
```

---

## WASM Plugins

Identified by `signalk-wasm-plugin` keyword and `wasmManifest` field in `package.json`:

```json
{
  "name": "my-plugin-name",
  "wasmManifest": "plugin.wasm",
  "wasmCapabilities": { ... },
  "keywords": ["signalk-wasm-plugin"]
}
```

Language options: AssemblyScript (3-10 KB, TS-like), Rust (50-200 KB, best perf), Go/TinyGo (50-150 KB).

Capabilities: delta emission, status reporting, config, file storage, HTTP endpoints, static files, network access, resource/weather/radar providers.

---

## Connection Backpressure

When a client is slow, the server accumulates latest values and flushes with a `$backpressure` indicator:

```js
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.$backpressure) {
    console.warn(`Backpressure: ${msg.$backpressure.accumulated} paths over ${msg.$backpressure.duration}ms`)
  }
  handleDelta(msg)
}
```

- WebSocket / Signal K TCP: accumulate + flush
- NMEA TCP: drop + disconnect for slow clients

---

## WebApps

Types:
- `signalk-webapp` — standalone (takes over full page)
- `signalk-embeddable-webapp` — embedded in Admin UI
- `signalk-plugin-configurator` — replaces plugin config form
- `signalk-node-server-addon` — embedded component

Place UI files in `/public/`. Server mounts them at `http://{skserver}:3000/{pluginId}`.

### Application Data Storage
```
GET/POST /signalk/v1/applicationData/global/:appid/:version
GET/POST /signalk/v1/applicationData/user/:appid/:version
```

### Discover Server Features
```
GET /signalk/v2/features
GET /signalk/v2/features?enable=1
```

### Module Federation (Vite)
```js
federation({
  name: 'my-plugin',
  filename: 'remoteEntry.js',
  exposes: { './PluginConfigurationPanel': './src/PluginConfigurationPanel.tsx' },
  shared: {
    react: { singleton: true, requiredVersion: false },
    'react-dom': { singleton: true, requiredVersion: false }
  }
})
```

---

## Custom Data Browser Renderers

A Custom Renderer is a React component that takes `value` as a prop:

```jsx
const BoldRenderer = ({ value }) => <div><b>{value}</b></div>
```

Add to `package.json`:
- keyword: `signalk-node-server-addon`
- Configure Module Federation to expose the component

Assign renderer to a path via meta delta:
```json
{
  "path": "sample.value",
  "value": {
    "renderer": {
      "module": "renderer-plugin",
      "name": "SampleRenderer",
      "options": {}
    }
  }
}
```

---

## Publishing to the AppStore

Required `package.json` keywords:
- `signalk-node-server-plugin` — for plugins
- `signalk-webapp` — for webapps

Category keywords: `signalk-category-ais`, `signalk-category-nmea-2000`, `signalk-category-instruments`, `signalk-category-hardware`, `signalk-category-notifications`, `signalk-category-weather`, `signalk-category-utility`, etc.

**Important:** AppStore installs with `npm install --ignore-scripts`. Use `prepublishOnly` for build steps, not `postinstall`.

```bash
npm publish
```

---

## Removing a Plugin

Manual removal:
1. Delete `~/.signalk/node_modules/<plugin-name>`
2. Remove entry from `~/.signalk/package.json`
3. Run `npm prune` from `~/.signalk/`
4. Remove config file from `~/.signalk/plugin-config-data/`
