import { NativeEventEmitter, NativeModules } from "react-native"
import resolveAssetSource from "react-native/Libraries/Image/resolveAssetSource"

const { RNSound } = NativeModules
const IsAndroid = RNSound.IsAndroid
const IsWindows = RNSound.IsWindows
const eventEmitter = new NativeEventEmitter(RNSound)

export const MediaStates = {
  DESTROYED: -2,
  ERROR: -1,
  IDLE: 0,
  PREPARING: 1,
  PREPARED: 2,
  SEEKING: 3,
  PLAYING: 4,
  RECORDING: 4,
  PAUSED: 5
}

function isRelativePath(path) {
  return !/^(\/|http(s?)|asset)/.test(path)
}

// Hash function to compute key from the filename
function djb2Code(str) {
  let hash = 5381,
    i,
    char
  for (i = 0; i < str.length; i++) {
    char = str.charCodeAt(i)
    hash = (hash << 5) + hash + char /* hash * 33 + c */
  }
  return hash
}

class Sound {
  _state = MediaStates.IDLE
  _loaded = false
  _playing = false
  _paused = false
  _stopped = false
  _duration = -1
  _numberOfChannels = -1
  _volume = 1
  _pan = 0
  _numberOfLoops = 0
  _speed = 1
  _stateChangeCbs = []

  constructor(filename, { basePath, options } = {}) {
    const asset = resolveAssetSource(filename)

    if (asset) {
      this._asset = asset
      this._filename = asset.uri
    } else {
      this._filename = basePath ? basePath + "/" + filename : filename

      if (IsAndroid && !basePath && isRelativePath(filename)) {
        this._filename = filename.toLowerCase().replace(/\.[^.]+$/, "")
      }
    }

    this.filename = filename
    this.basePath = basePath
    this.options = options
  }

  prepare() {
    if (this._loaded) return

    this._updateState(null, MediaStates.PREPARING)

    this._key = this._asset ? this.filename : djb2Code(this.filename) //if the file is an asset, use the asset number as the key

    RNSound.prepare(
      this._filename,
      this._key,
      this.options || {},
      (error, props) => {
        if (props) {
          if (typeof props.duration === "number") {
            this._duration = props.duration
          }
          if (typeof props.numberOfChannels === "number") {
            this._numberOfChannels = props.numberOfChannels
          }
        }

        if (error) {
          this._updateState(error, MediaStates.ERROR, props)
        }

        this._updateState(null, MediaStates.PREPARED, props)
        this._loaded = true
        this.registerOnPlay()
      }
    )
  }

  registerOnPlay() {
    if (this.onPlaySubscription != null) {
      console.warn("On Play change event listener is already registered")
      return
    }

    let terminate

    if (!IsWindows) {
      this.onPlaySubscription = eventEmitter.addListener(
        "onPlayChange",
        param => {
          const { isPlaying, playerKey } = param

          if (playerKey === this._key) {
            if (isPlaying) {
              terminate = this.watchPlayingCurrentTime()
              return
            }

            terminate && terminate()

            if (this._paused) {
              return this._updateState(null, MediaStates.PAUSED)
            }

            if (this._stopped) {
              return this._updateState(null, MediaStates.PREPARED)
            }

            this._updateState(null, MediaStates.PREPARED, { ended: true })
          }
        }
      )
    }
  }

  isLoaded() {
    return this._loaded
  }

  onStateChange(cb) {
    if (!this._stateChangeCbs.includes(cb)) {
      this._stateChangeCbs.push(cb)
    }
    return () => {
      const index = this._stateChangeCbs.indexOf(cb)
      if (index > -1) this._stateChangeCbs.splice(index, 1)
    }
  }

  play() {
    if (this._loaded) {
      this._stopped = false
      this._paused = false
      this._playing = true

      RNSound.play(this._key, successfully => {
        this._updateState(null, MediaStates.PREPARED)
      })
    }
    return this
  }

  pause(callback) {
    if (this._loaded) {
      RNSound.pause(this._key, () => {
        this._stopped = false
        this._paused = true
        this._playing = false
        this._updateState(null, MediaStates.PAUSED)
        callback && callback()
      })
    }
    return this
  }

  stop(callback) {
    if (this._loaded) {
      RNSound.stop(this._key, () => {
        this._stopped = true
        this._paused = false
        this._playing = false
        this._updateState(null, MediaStates.PREPARED)
        callback && callback()
      })
    }
    return this
  }

  reset() {
    if (this._loaded && IsAndroid) {
      RNSound.reset(this._key)
      this._updateState(null, MediaStates.PREPARED)
      this._stopped = false
      this._paused = false
      this._playing = false
    }
    return this
  }

  release() {
    if (this._loaded) {
      RNSound.release(this._key)
      this._loaded = false
      if (!IsWindows) {
        if (this.onPlaySubscription != null) {
          this.onPlaySubscription.remove()
          this.onPlaySubscription = null
          this._updateState(null, MediaStates.DESTROYED)
        }
      }
    }
    return this
  }

  setVolume(value) {
    this._volume = value
    if (this._loaded) {
      if (IsAndroid || IsWindows) {
        RNSound.setVolume(this._key, value, value)
      } else {
        RNSound.setVolume(this._key, value)
      }
    }
    return this
  }

  getSystemVolume(callback) {
    if (IsAndroid) {
      RNSound.getSystemVolume(callback)
    }
    return this
  }

  setSystemVolume(value) {
    if (IsAndroid) {
      RNSound.setSystemVolume(value)
    }
    return this
  }

  getPan() {
    return this._pan
  }

  setPan(value) {
    if (this._loaded) {
      RNSound.setPan(this._key, (this._pan = value))
    }
    return this
  }

  getNumberOfLoops() {
    return this._numberOfLoops
  }

  setNumberOfLoops(value) {
    this._numberOfLoops = value
    if (this._loaded) {
      if (IsAndroid || IsWindows) {
        RNSound.setLooping(this._key, !!value)
      } else {
        RNSound.setNumberOfLoops(this._key, value)
      }
    }
    return this
  }

  setSpeed(value) {
    this._speed = value
    if (this._loaded) {
      if (!IsWindows) {
        RNSound.setSpeed(this._key, value)
      }
    }
    return this
  }

  getCurrentTime(callback) {
    if (this._loaded) {
      RNSound.getCurrentTime(this._key, callback)
    }
  }

  setCurrentTime(value) {
    if (this._loaded) {
      this._updateState(null, MediaStates.SEEKING)
      RNSound.setCurrentTime(this._key, value)
    }
    return this
  }

  watchPlayingCurrentTime = (() => {
    let _timeout

    const setTime = () => {
      _timeout = null

      this.getCurrentTime(currentTime => {
        if (!this._playing) return

        this._currentTime = currentTime
        this._updateState(null, MediaStates.PLAYING, { currentTime })

        _timeout = setTimeout(setTime, 250)
      })
    }

    return () => {
      setTime()
      return () => _timeout && clearTimeout(_timeout)
    }
  })()

  // android only
  setSpeakerphoneOn(value) {
    if (IsAndroid) {
      RNSound.setSpeakerphoneOn(this._key, value)
    }
  }

  // ios only
  // This is deprecated.  Call the static one instead.
  setCategory(value) {
    Sound.setCategory(value, false)
  }

  _updateState(err, state, ...data) {
    this._stateChangeCbs.forEach(cb => cb(err, state, ...data))
    this._state = err ? MediaStates.ERROR : state
  }

  get isPlaying() {
    return this._playing
  }

  get isPaused() {
    return this._paused
  }

  get isStopped() {
    return this._stopped
  }

  get canPlay() {
    return this._loaded && this._state >= MediaStates.PREPARED
  }

  get currentTime() {
    return this._currentTime
  }

  get duration() {
    return this._duration
  }

  get numberOfChannels() {
    return this._numberOfChannels
  }

  get volume() {
    return this._volume
  }

  static enable(enabled) {
    RNSound.enable(enabled)
  }

  static enableInSilenceMode(enabled) {
    if (!IsAndroid && !IsWindows) {
      RNSound.enableInSilenceMode(enabled)
    }
  }

  static setActive(value) {
    if (!IsAndroid && !IsWindows) {
      RNSound.setActive(value)
    }
  }

  static setCategory(value, mixWithOthers = false) {
    if (!IsWindows) {
      RNSound.setCategory(value, mixWithOthers)
    }
  }

  static setMode(value) {
    if (!IsAndroid && !IsWindows) {
      RNSound.setMode(value)
    }
  }

  static MAIN_BUNDLE = RNSound.MainBundlePath
  static DOCUMENT = RNSound.NSDocumentDirectory
  static LIBRARY = RNSound.NSLibraryDirectory
  static CACHES = RNSound.NSCachesDirectory
}

export default Sound
