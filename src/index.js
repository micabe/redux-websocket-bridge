import io from 'socket.io-client'
import blobToArrayBuffer from './blobToArrayBuffer'
import isFSA from './isFSA'

export const CLOSE = `CLOSE`
export const MESSAGE = `MESSAGE`
export const OPEN = `OPEN`
export const SEND = `SEND`

export function close() {
  return { type: CLOSE }
}

export function message(payload) {
  return { type: MESSAGE, payload }
}

export function open() {
  return { type: OPEN }
}

const DEFAULT_OPTIONS = {
  binaryType: 'arraybuffer',
  fold: (action, webSocket) => {
    if (
      action.meta &&
      arrayify(action.meta.send).some(send => send === true || send === webSocket)
    ) {
      const { meta, ...actionWithoutMeta } = action

      return JSON.stringify(actionWithoutMeta)
    }
  },
  meta: {},
  namespace: '@@websocket/',
  unfold: (payload, webSocket, raw) => {
    const action = tryParseJSON(payload)

    return (
      action && {
        ...action,
        meta: {
          ...action.meta,
          webSocket,
        },
      }
    )
  },
}

function arrayify(obj) {
  return obj ? (Array.isArray(obj) ? obj : [obj]) : []
}

export default function createWebSocketMiddleware(urlOrFactory, options = DEFAULT_OPTIONS) {
  options = { ...DEFAULT_OPTIONS, ...options }
  options.binaryType = options.binaryType.toLowerCase()
  options.unfold =
    options.unfold &&
    (typeof options.unfold === 'function' ? options.unfold : DEFAULT_OPTIONS.unfold)

  const { namespace } = options

  return store => {
    const socket = io(urlOrFactory, {
      transports: ['websocket'],
      upgrade: true,
    })

    const patch = require('socketio-wildcard')(io.Manager)
    patch(socket)

    const webSocket = socket
    socket.on('connect', () => {
      store.dispatch({ type: `${namespace}${OPEN}`, meta: { webSocket } })
    })
    socket.on('disconnect', () => {
      store.dispatch({ type: `${namespace}${CLOSE}`, meta: { webSocket } })
    })

    // on reconnection, reset the transports option, as the Websocket
    // connection may have failed (caused by proxy, firewall, browser, ...)
    // socket.on('reconnect_attempt', () => {
    //   socket.io.opts.transports = ['polling', 'websocket']
    // })

    socket.on('*', event => {
      console.log(event)
      if (
        typeof Blob !== 'undefined' &&
        options.binaryType === 'arraybuffer' &&
        event.data instanceof Blob
      ) {
        getPayload = blobToArrayBuffer(event.data)
      } else if (
        typeof ArrayBuffer !== 'undefined' &&
        options.binaryType === 'blob' &&
        event.data instanceof ArrayBuffer
      ) {
        getPayload = new Blob([event.data])
      } else {
        // We make this a Promise because we might want to keep the sequence of dispatch, @@websocket/MESSAGE first, then unfold later.
        getPayload = Promise.resolve(event.data)
      }

      return getPayload.then(payload => {
        if (options.unfold) {
          const action = options.unfold(payload, webSocket, payload)

          if (action) {
            if (!isFSA(action)) {
              throw new Error('Unfolded action is not a Flux Standard Action compliant')
            }

            return action && store.dispatch(action)
          }
        }

        store.dispatch({
          type: `${namespace}${MESSAGE}`,
          meta: { webSocket },
          payload,
        })
      })
    })

    return next => action => {
      if (action.type === `${namespace}${SEND}`) {
        socket.send(action.payload)
      } else {
        const payload = options.fold(action, webSocket)

        payload && socket.send(payload)
      }

      return next(action)
    }
  }
}

function tryParseJSON(json) {
  try {
    return JSON.parse(json)
  } catch (err) {}
}

export function trimUndefined(map) {
  return Object.keys(map).reduce((nextMap, key) => {
    const value = map[key]

    if (typeof value !== 'undefined') {
      nextMap[key] = value
    }

    return nextMap
  }, {})
}
