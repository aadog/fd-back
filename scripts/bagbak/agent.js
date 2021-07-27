(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
        "use strict";
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.warmup = exports.prepare = exports.dump = exports.base = void 0;
        const transfer_1 = require("./transfer");
        const path_1 = require("./path");
        const threads_1 = require("./threads");
        const ctx = {};
        const EncryptInfoTuple = ['pointer', 'uint32', 'uint32', 'uint32', 'uint32'];
        function beep() {
            try {
                const SOUND = 1007;
                const playSound = Module.findExportByName('AudioToolbox', 'AudioServicesPlaySystemSound');
                new NativeFunction(playSound, 'void', ['int'])(SOUND);
            }
            catch (e) {
            }
        }
        function base() {
            return path_1.normalize(ObjC.classes.NSBundle.mainBundle().bundlePath().toString());
        }
        exports.base = base;
        async function dump(opt = {}) {
            // load all frameworks
            warmup();
            // freeze all threads
            threads_1.freeze();
            const bundle = base();
            const downloaded = {};
            for (let mod of Process.enumerateModules()) {
                const filename = path_1.normalize(mod.path);
                if (!filename.startsWith(bundle))
                    continue;
                const info = ctx.findEncyptInfo(mod.base);
                const [ptr, offset, size, offsetOfCmd, sizeOfCmd] = info;
                if (ptr.isNull())
                    continue;
                await transfer_1.download(filename);
                downloaded[filename] = true;
                // skip fat header
                const fatOffset = Process.findRangeByAddress(mod.base).file.offset;
                // dump decrypted
                const session = transfer_1.memcpy(mod.base.add(offset), size);
                send({ subject: 'patch', offset: fatOffset + offset, blob: session, filename });
                // erase cryptoff
                send({ subject: 'patch', offset: fatOffset + offsetOfCmd, size: sizeOfCmd, filename });
            }
            threads_1.wakeup();
            if (!opt.executableOnly)
                await pull(bundle, downloaded);
            beep();
            return 0;
        }
        exports.dump = dump;
        async function pull(bundle, downloaded) {
            const manager = ObjC.classes.NSFileManager.defaultManager();
            const enumerator = manager.enumeratorAtPath_(bundle);
            const pIsDir = Memory.alloc(Process.pointerSize);
            const base = ObjC.classes.NSString.alloc().initWithString_(bundle);
            const skip = /\bSC\_Info\/((.+\.s(inf|up[fpx]))|Manifest\.plist)$/;
            let path;
            while ((path = enumerator.nextObject())) {
                if (skip.exec(path.toString()))
                    continue;
                const fullname = path_1.normalize(base.stringByAppendingPathComponent_(path));
                if (downloaded[fullname])
                    continue;
                pIsDir.writePointer(NULL);
                manager.fileExistsAtPath_isDirectory_(fullname, pIsDir);
                if (pIsDir.readPointer().isNull()) {
                    await transfer_1.download(fullname);
                }
            }
        }
        function prepare(c) {
            const cm = new CModule(c);
            ctx.cm = cm;
            ctx.findEncyptInfo = new NativeFunction(cm['find_encryption_info'], EncryptInfoTuple, ['pointer']);
        }
        exports.prepare = prepare;
        function warmup() {
            const { NSFileManager, NSBundle } = ObjC.classes;
            const path = NSBundle.mainBundle().bundlePath().stringByAppendingPathComponent_('Frameworks');
            const mgr = NSFileManager.defaultManager();
            const pError = Memory.alloc(Process.pointerSize);
            pError.writePointer(NULL);
            const files = mgr.contentsOfDirectoryAtPath_error_(path, pError);
            const err = pError.readPointer();
            if (!err.isNull()) {
                const errObj = new ObjC.Object(err);
                const NSFileReadNoSuchFileError = 260;
                if (errObj.code().valueOf() === NSFileReadNoSuchFileError)
                    return;
                return void console.error(new ObjC.Object(err));
            }
            const max = files.count();
            for (let i = 0; i < max; i++) {
                const name = files.objectAtIndex_(i);
                const bundle = NSBundle.bundleWithPath_(path.stringByAppendingPathComponent_(name));
                if (bundle)
                    bundle.load();
            }
        }
        exports.warmup = warmup;
    },{"./path":3,"./threads":6,"./transfer":7}],2:[function(require,module,exports){
        "use strict";
        Object.defineProperty(exports, "__esModule", { value: true });
        if (typeof CModule === 'undefined')
            throw new Error('Your frida does not support CModule. Version: ' + Frida.version);
        const dump_1 = require("./dump");
        const pkd_1 = require("./pkd");
        const pluginkit_1 = require("./pluginkit");
        rpc.exports = {
            dump: dump_1.dump,
            prepare: dump_1.prepare,
            plugins: pluginkit_1.plugins,
            launchAll: pluginkit_1.launchAll,
            base: dump_1.base,
            // pkd
            skipPkdValidationFor: pkd_1.skipPkdValidationFor,
            jetsam: pkd_1.jetsam,
        };
    },{"./dump":1,"./pkd":4,"./pluginkit":5}],3:[function(require,module,exports){
        "use strict";
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.normalize = exports.relativeTo = void 0;
        const SEP = '/';
        function relativeTo(base, full) {
            const a = normalize(base).split(SEP);
            const b = normalize(full).split(SEP);
            let i = 0;
            while (a[i] === b[i])
                i++;
            return b.slice(i).join(SEP);
        }
        exports.relativeTo = relativeTo;
        function normalize(path) {
            return ObjC.classes.NSString
                .stringWithString_(path).stringByStandardizingPath().toString();
        }
        exports.normalize = normalize;
    },{}],4:[function(require,module,exports){
        "use strict";
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.skipPkdValidationFor = exports.jetsam = void 0;
        function jetsam(pid) {
            const MEMORYSTATUS_CMD_SET_JETSAM_TASK_LIMIT = 6;
            const p = Module.findExportByName(null, 'memorystatus_control');
            const memctl = new NativeFunction(p, 'int', ['uint32', 'int32', 'uint32', 'pointer', 'uint32']);
            return memctl(MEMORYSTATUS_CMD_SET_JETSAM_TASK_LIMIT, pid, 256, NULL, 0);
        }
        exports.jetsam = jetsam;
        function skipPkdValidationFor(pid) {
            if ('PKDPlugIn' in ObjC.classes) {
                const { PKDPlugIn } = ObjC.classes;
                const canidates = ['- allowForClient:discoveryInstanceUUID:', '- allowForClient:'];
                for (const name of canidates) {
                    const method = PKDPlugIn[name];
                    if (method) {
                        const original = method.implementation;
                        method.implementation = ObjC.implement(method, function (self, sel, conn) {
                            // race condition huh? we don't care
                            return pid === new ObjC.Object(conn).pid() ?
                                NULL : original(self, sel, conn);
                        });
                        break;
                    }
                }
            }
        }
        exports.skipPkdValidationFor = skipPkdValidationFor;
    },{}],5:[function(require,module,exports){
        "use strict";
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.launchAll = exports.launch = exports.plugins = void 0;
        function plugins() {
            const { LSApplicationWorkspace, NSString, NSMutableArray, NSPredicate, NSBundle } = ObjC.classes;
            const args = NSMutableArray.alloc().init();
            args.setObject_atIndex_(NSBundle.mainBundle().bundleIdentifier(), 0);
            const fmt = NSString.stringWithString_('containingBundle.applicationIdentifier=%@');
            const predicate = NSPredicate.predicateWithFormat_argumentArray_(fmt, args);
            const plugins = LSApplicationWorkspace.defaultWorkspace()
                .installedPlugins().filteredArrayUsingPredicate_(predicate);
            const result = [];
            for (let i = 0; i < plugins.count(); i++) {
                result.push(plugins.objectAtIndex_(i).pluginIdentifier().toString());
            }
            args.release();
            return result;
        }
        exports.plugins = plugins;
        function launch(id) {
            const { NSExtension, NSString } = ObjC.classes;
            const identifier = NSString.stringWithString_(id);
            const extension = NSExtension.extensionWithIdentifier_error_(identifier, NULL);
            identifier.release();
            if (!extension)
                return Promise.reject(new Error(`unable to create extension ${id}`));
            const pid = extension['- _plugInProcessIdentifier']();
            if (pid)
                return Promise.resolve(pid);
            return new Promise((resolve, reject) => {
                extension.beginExtensionRequestWithInputItems_completion_(NULL, new ObjC.Block({
                    retType: 'void',
                    argTypes: ['object'],
                    implementation(requestIdentifier) {
                        const pid = extension.pidForRequestIdentifier_(requestIdentifier);
                        extension.release();
                        resolve(pid);
                    }
                }));
            });
        }
        exports.launch = launch;
        /*
  -[NSExtension _newExtensionContextAndGetConnection:assertion:inputItems:]

  v8 = _objc_msgSend((void *)self->_infoDictionary, "objectForKey:", CFSTR("NSExtension"));
  v9 = _objc_msgSend(v8, "objectForKey:", CFSTR("NSExtensionContextHostClass"));
  if ( v9
    || (v9 = _objc_msgSend((void *)self->_infoDictionary, "objectForKey:", CFSTR("NSExtensionContextHostClass"))) != 0LL )
  {
    v10 = v6;
    v11 = _objc_msgSend(v9, "UTF8String");
    v12 = (void *)objc_getClass(v11);
  }
  else
  {
    v10 = v6;
    v12 = _objc_msgSend(&OBJC_CLASS___NSExtensionContext, "class");
  }

  if the given class does not exist, a nil ptr exception will throw
 */
        const baseClazz = Memory.allocUtf8String('NSExtensionContext');
        Interceptor.attach(Module.findExportByName(null, 'objc_getClass'), {
            onEnter(args) {
                const clz = args[0].readUtf8String();
                if (clz.endsWith('ExtensionHostContext'))
                    args[0] = baseClazz;
            }
        });
        function launchAll() {
            return Promise.all(plugins().map(id => launch(id)));
        }
        exports.launchAll = launchAll;
    },{}],6:[function(require,module,exports){
        "use strict";
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.wakeup = exports.freeze = void 0;
        const threads = {};
        for (let action of ['suspend', 'resume']) {
            threads[action] = new NativeFunction(Module.findExportByName('libsystem_kernel.dylib', `thread_${action}`), 'pointer', ['uint']);
        }
        function freeze() {
            for (let { id } of Process.enumerateThreads())
                threads.suspend(id);
        }
        exports.freeze = freeze;
        function wakeup() {
            for (let { id } of Process.enumerateThreads())
                threads.resume(id);
        }
        exports.wakeup = wakeup;
    },{}],7:[function(require,module,exports){
        "use strict";
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.download = exports.memcpy = void 0;
        const fs_1 = require("fs");
        function send2(payload, data) {
            send(payload, data);
            recv('ack', () => { }).wait();
        }
        function memcpy(address, size) {
            const session = Math.random().toString(36).substr(2);
            const highWaterMark = 4 * 1024 * 1024;
            const subject = 'memcpy';
            send2({
                subject,
                event: 'begin',
                session,
                size,
            });
            const count = Math.floor(size / highWaterMark);
            const tail = size % highWaterMark;
            let p = address;
            let i = 0;
            while (i++ < count) {
                send2({
                    subject,
                    event: 'data',
                    session,
                    index: i,
                }, p.readByteArray(highWaterMark));
                p = p.add(highWaterMark);
            }
            if (tail) {
                send2({
                    subject,
                    event: 'data',
                    session,
                    index: i,
                }, p.readByteArray(tail));
            }
            send({
                subject,
                event: 'end',
                session,
            });
            return session;
        }
        exports.memcpy = memcpy;
        async function download(filename) {
            const session = Math.random().toString(36).substr(2);
            const highWaterMark = 4 * 1024 * 1024;
            const subject = 'download';
            const { size, atimeMs, mtimeMs, mode } = fs_1.statSync(filename);
            const stream = fs_1.createReadStream(filename, { highWaterMark });
            send2({
                subject,
                event: 'begin',
                session,
                filename,
                stat: {
                    size,
                    atimeMs,
                    mtimeMs,
                    mode,
                },
            });
            await new Promise((resolve, reject) => stream
                .on('data', (chunk) => {
                    send2({
                        subject,
                        event: 'data',
                        session,
                    }, chunk);
                })
                .on('end', resolve)
                .on('error', reject));
            send({
                subject,
                event: 'end',
                session,
            });
        }
        exports.download = download;
    },{"fs":13}],8:[function(require,module,exports){
        'use strict'

        exports.byteLength = byteLength
        exports.toByteArray = toByteArray
        exports.fromByteArray = fromByteArray

        var lookup = []
        var revLookup = []
        var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

        var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
        for (var i = 0, len = code.length; i < len; ++i) {
            lookup[i] = code[i]
            revLookup[code.charCodeAt(i)] = i
        }

// Support decoding URL-safe base64 strings, as Node.js does.
// See: https://en.wikipedia.org/wiki/Base64#URL_applications
        revLookup['-'.charCodeAt(0)] = 62
        revLookup['_'.charCodeAt(0)] = 63

        function getLens (b64) {
            var len = b64.length

            if (len % 4 > 0) {
                throw new Error('Invalid string. Length must be a multiple of 4')
            }

            // Trim off extra bytes after placeholder bytes are found
            // See: https://github.com/beatgammit/base64-js/issues/42
            var validLen = b64.indexOf('=')
            if (validLen === -1) validLen = len

            var placeHoldersLen = validLen === len
                ? 0
                : 4 - (validLen % 4)

            return [validLen, placeHoldersLen]
        }

// base64 is 4/3 + up to two characters of the original data
        function byteLength (b64) {
            var lens = getLens(b64)
            var validLen = lens[0]
            var placeHoldersLen = lens[1]
            return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
        }

        function _byteLength (b64, validLen, placeHoldersLen) {
            return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
        }

        function toByteArray (b64) {
            var tmp
            var lens = getLens(b64)
            var validLen = lens[0]
            var placeHoldersLen = lens[1]

            var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen))

            var curByte = 0

            // if there are placeholders, only get up to the last complete 4 chars
            var len = placeHoldersLen > 0
                ? validLen - 4
                : validLen

            var i
            for (i = 0; i < len; i += 4) {
                tmp =
                    (revLookup[b64.charCodeAt(i)] << 18) |
                    (revLookup[b64.charCodeAt(i + 1)] << 12) |
                    (revLookup[b64.charCodeAt(i + 2)] << 6) |
                    revLookup[b64.charCodeAt(i + 3)]
                arr[curByte++] = (tmp >> 16) & 0xFF
                arr[curByte++] = (tmp >> 8) & 0xFF
                arr[curByte++] = tmp & 0xFF
            }

            if (placeHoldersLen === 2) {
                tmp =
                    (revLookup[b64.charCodeAt(i)] << 2) |
                    (revLookup[b64.charCodeAt(i + 1)] >> 4)
                arr[curByte++] = tmp & 0xFF
            }

            if (placeHoldersLen === 1) {
                tmp =
                    (revLookup[b64.charCodeAt(i)] << 10) |
                    (revLookup[b64.charCodeAt(i + 1)] << 4) |
                    (revLookup[b64.charCodeAt(i + 2)] >> 2)
                arr[curByte++] = (tmp >> 8) & 0xFF
                arr[curByte++] = tmp & 0xFF
            }

            return arr
        }

        function tripletToBase64 (num) {
            return lookup[num >> 18 & 0x3F] +
                lookup[num >> 12 & 0x3F] +
                lookup[num >> 6 & 0x3F] +
                lookup[num & 0x3F]
        }

        function encodeChunk (uint8, start, end) {
            var tmp
            var output = []
            for (var i = start; i < end; i += 3) {
                tmp =
                    ((uint8[i] << 16) & 0xFF0000) +
                    ((uint8[i + 1] << 8) & 0xFF00) +
                    (uint8[i + 2] & 0xFF)
                output.push(tripletToBase64(tmp))
            }
            return output.join('')
        }

        function fromByteArray (uint8) {
            var tmp
            var len = uint8.length
            var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
            var parts = []
            var maxChunkLength = 16383 // must be multiple of 3

            // go through the array every three bytes, we'll deal with trailing stuff later
            for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
                parts.push(encodeChunk(
                    uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)
                ))
            }

            // pad the end with zeros, but make sure to not forget the extra bytes
            if (extraBytes === 1) {
                tmp = uint8[len - 1]
                parts.push(
                    lookup[tmp >> 2] +
                    lookup[(tmp << 4) & 0x3F] +
                    '=='
                )
            } else if (extraBytes === 2) {
                tmp = (uint8[len - 2] << 8) + uint8[len - 1]
                parts.push(
                    lookup[tmp >> 10] +
                    lookup[(tmp >> 4) & 0x3F] +
                    lookup[(tmp << 2) & 0x3F] +
                    '='
                )
            }

            return parts.join('')
        }

    },{}],9:[function(require,module,exports){

    },{}],10:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

        'use strict';

        var R = typeof Reflect === 'object' ? Reflect : null
        var ReflectApply = R && typeof R.apply === 'function'
            ? R.apply
            : function ReflectApply(target, receiver, args) {
                return Function.prototype.apply.call(target, receiver, args);
            }

        var ReflectOwnKeys
        if (R && typeof R.ownKeys === 'function') {
            ReflectOwnKeys = R.ownKeys
        } else if (Object.getOwnPropertySymbols) {
            ReflectOwnKeys = function ReflectOwnKeys(target) {
                return Object.getOwnPropertyNames(target)
                    .concat(Object.getOwnPropertySymbols(target));
            };
        } else {
            ReflectOwnKeys = function ReflectOwnKeys(target) {
                return Object.getOwnPropertyNames(target);
            };
        }

        function ProcessEmitWarning(warning) {
            if (console && console.warn) console.warn(warning);
        }

        var NumberIsNaN = Number.isNaN || function NumberIsNaN(value) {
            return value !== value;
        }

        function EventEmitter() {
            EventEmitter.init.call(this);
        }
        module.exports = EventEmitter;
        module.exports.once = once;

// Backwards-compat with node 0.10.x
        EventEmitter.EventEmitter = EventEmitter;

        EventEmitter.prototype._events = undefined;
        EventEmitter.prototype._eventsCount = 0;
        EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
        var defaultMaxListeners = 10;

        function checkListener(listener) {
            if (typeof listener !== 'function') {
                throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
            }
        }

        Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
            enumerable: true,
            get: function() {
                return defaultMaxListeners;
            },
            set: function(arg) {
                if (typeof arg !== 'number' || arg < 0 || NumberIsNaN(arg)) {
                    throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + '.');
                }
                defaultMaxListeners = arg;
            }
        });

        EventEmitter.init = function() {

            if (this._events === undefined ||
                this._events === Object.getPrototypeOf(this)._events) {
                this._events = Object.create(null);
                this._eventsCount = 0;
            }

            this._maxListeners = this._maxListeners || undefined;
        };

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
        EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
            if (typeof n !== 'number' || n < 0 || NumberIsNaN(n)) {
                throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + '.');
            }
            this._maxListeners = n;
            return this;
        };

        function _getMaxListeners(that) {
            if (that._maxListeners === undefined)
                return EventEmitter.defaultMaxListeners;
            return that._maxListeners;
        }

        EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
            return _getMaxListeners(this);
        };

        EventEmitter.prototype.emit = function emit(type) {
            var args = [];
            for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
            var doError = (type === 'error');

            var events = this._events;
            if (events !== undefined)
                doError = (doError && events.error === undefined);
            else if (!doError)
                return false;

            // If there is no 'error' event listener then throw.
            if (doError) {
                var er;
                if (args.length > 0)
                    er = args[0];
                if (er instanceof Error) {
                    // Note: The comments on the `throw` lines are intentional, they show
                    // up in Node's output if this results in an unhandled exception.
                    throw er; // Unhandled 'error' event
                }
                // At least give some kind of context to the user
                var err = new Error('Unhandled error.' + (er ? ' (' + er.message + ')' : ''));
                err.context = er;
                throw err; // Unhandled 'error' event
            }

            var handler = events[type];

            if (handler === undefined)
                return false;

            if (typeof handler === 'function') {
                ReflectApply(handler, this, args);
            } else {
                var len = handler.length;
                var listeners = arrayClone(handler, len);
                for (var i = 0; i < len; ++i)
                    ReflectApply(listeners[i], this, args);
            }

            return true;
        };

        function _addListener(target, type, listener, prepend) {
            var m;
            var events;
            var existing;

            checkListener(listener);

            events = target._events;
            if (events === undefined) {
                events = target._events = Object.create(null);
                target._eventsCount = 0;
            } else {
                // To avoid recursion in the case that type === "newListener"! Before
                // adding it to the listeners, first emit "newListener".
                if (events.newListener !== undefined) {
                    target.emit('newListener', type,
                        listener.listener ? listener.listener : listener);

                    // Re-assign `events` because a newListener handler could have caused the
                    // this._events to be assigned to a new object
                    events = target._events;
                }
                existing = events[type];
            }

            if (existing === undefined) {
                // Optimize the case of one listener. Don't need the extra array object.
                existing = events[type] = listener;
                ++target._eventsCount;
            } else {
                if (typeof existing === 'function') {
                    // Adding the second element, need to change to array.
                    existing = events[type] =
                        prepend ? [listener, existing] : [existing, listener];
                    // If we've already got an array, just append.
                } else if (prepend) {
                    existing.unshift(listener);
                } else {
                    existing.push(listener);
                }

                // Check for listener leak
                m = _getMaxListeners(target);
                if (m > 0 && existing.length > m && !existing.warned) {
                    existing.warned = true;
                    // No error code for this since it is a Warning
                    // eslint-disable-next-line no-restricted-syntax
                    var w = new Error('Possible EventEmitter memory leak detected. ' +
                        existing.length + ' ' + String(type) + ' listeners ' +
                        'added. Use emitter.setMaxListeners() to ' +
                        'increase limit');
                    w.name = 'MaxListenersExceededWarning';
                    w.emitter = target;
                    w.type = type;
                    w.count = existing.length;
                    ProcessEmitWarning(w);
                }
            }

            return target;
        }

        EventEmitter.prototype.addListener = function addListener(type, listener) {
            return _addListener(this, type, listener, false);
        };

        EventEmitter.prototype.on = EventEmitter.prototype.addListener;

        EventEmitter.prototype.prependListener =
            function prependListener(type, listener) {
                return _addListener(this, type, listener, true);
            };

        function onceWrapper() {
            if (!this.fired) {
                this.target.removeListener(this.type, this.wrapFn);
                this.fired = true;
                if (arguments.length === 0)
                    return this.listener.call(this.target);
                return this.listener.apply(this.target, arguments);
            }
        }

        function _onceWrap(target, type, listener) {
            var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
            var wrapped = onceWrapper.bind(state);
            wrapped.listener = listener;
            state.wrapFn = wrapped;
            return wrapped;
        }

        EventEmitter.prototype.once = function once(type, listener) {
            checkListener(listener);
            this.on(type, _onceWrap(this, type, listener));
            return this;
        };

        EventEmitter.prototype.prependOnceListener =
            function prependOnceListener(type, listener) {
                checkListener(listener);
                this.prependListener(type, _onceWrap(this, type, listener));
                return this;
            };

// Emits a 'removeListener' event if and only if the listener was removed.
        EventEmitter.prototype.removeListener =
            function removeListener(type, listener) {
                var list, events, position, i, originalListener;

                checkListener(listener);

                events = this._events;
                if (events === undefined)
                    return this;

                list = events[type];
                if (list === undefined)
                    return this;

                if (list === listener || list.listener === listener) {
                    if (--this._eventsCount === 0)
                        this._events = Object.create(null);
                    else {
                        delete events[type];
                        if (events.removeListener)
                            this.emit('removeListener', type, list.listener || listener);
                    }
                } else if (typeof list !== 'function') {
                    position = -1;

                    for (i = list.length - 1; i >= 0; i--) {
                        if (list[i] === listener || list[i].listener === listener) {
                            originalListener = list[i].listener;
                            position = i;
                            break;
                        }
                    }

                    if (position < 0)
                        return this;

                    if (position === 0)
                        list.shift();
                    else {
                        spliceOne(list, position);
                    }

                    if (list.length === 1)
                        events[type] = list[0];

                    if (events.removeListener !== undefined)
                        this.emit('removeListener', type, originalListener || listener);
                }

                return this;
            };

        EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

        EventEmitter.prototype.removeAllListeners =
            function removeAllListeners(type) {
                var listeners, events, i;

                events = this._events;
                if (events === undefined)
                    return this;

                // not listening for removeListener, no need to emit
                if (events.removeListener === undefined) {
                    if (arguments.length === 0) {
                        this._events = Object.create(null);
                        this._eventsCount = 0;
                    } else if (events[type] !== undefined) {
                        if (--this._eventsCount === 0)
                            this._events = Object.create(null);
                        else
                            delete events[type];
                    }
                    return this;
                }

                // emit removeListener for all listeners on all events
                if (arguments.length === 0) {
                    var keys = Object.keys(events);
                    var key;
                    for (i = 0; i < keys.length; ++i) {
                        key = keys[i];
                        if (key === 'removeListener') continue;
                        this.removeAllListeners(key);
                    }
                    this.removeAllListeners('removeListener');
                    this._events = Object.create(null);
                    this._eventsCount = 0;
                    return this;
                }

                listeners = events[type];

                if (typeof listeners === 'function') {
                    this.removeListener(type, listeners);
                } else if (listeners !== undefined) {
                    // LIFO order
                    for (i = listeners.length - 1; i >= 0; i--) {
                        this.removeListener(type, listeners[i]);
                    }
                }

                return this;
            };

        function _listeners(target, type, unwrap) {
            var events = target._events;

            if (events === undefined)
                return [];

            var evlistener = events[type];
            if (evlistener === undefined)
                return [];

            if (typeof evlistener === 'function')
                return unwrap ? [evlistener.listener || evlistener] : [evlistener];

            return unwrap ?
                unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
        }

        EventEmitter.prototype.listeners = function listeners(type) {
            return _listeners(this, type, true);
        };

        EventEmitter.prototype.rawListeners = function rawListeners(type) {
            return _listeners(this, type, false);
        };

        EventEmitter.listenerCount = function(emitter, type) {
            if (typeof emitter.listenerCount === 'function') {
                return emitter.listenerCount(type);
            } else {
                return listenerCount.call(emitter, type);
            }
        };

        EventEmitter.prototype.listenerCount = listenerCount;
        function listenerCount(type) {
            var events = this._events;

            if (events !== undefined) {
                var evlistener = events[type];

                if (typeof evlistener === 'function') {
                    return 1;
                } else if (evlistener !== undefined) {
                    return evlistener.length;
                }
            }

            return 0;
        }

        EventEmitter.prototype.eventNames = function eventNames() {
            return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
        };

        function arrayClone(arr, n) {
            var copy = new Array(n);
            for (var i = 0; i < n; ++i)
                copy[i] = arr[i];
            return copy;
        }

        function spliceOne(list, index) {
            for (; index + 1 < list.length; index++)
                list[index] = list[index + 1];
            list.pop();
        }

        function unwrapListeners(arr) {
            var ret = new Array(arr.length);
            for (var i = 0; i < ret.length; ++i) {
                ret[i] = arr[i].listener || arr[i];
            }
            return ret;
        }

        function once(emitter, name) {
            return new Promise(function (resolve, reject) {
                function eventListener() {
                    if (errorListener !== undefined) {
                        emitter.removeListener('error', errorListener);
                    }
                    resolve([].slice.call(arguments));
                };
                var errorListener;

                // Adding an error listener is not optional because
                // if an error is thrown on an event emitter we cannot
                // guarantee that the actual event we are waiting will
                // be fired. The result could be a silent way to create
                // memory or file descriptor leaks, which is something
                // we should avoid.
                if (name !== 'error') {
                    errorListener = function errorListener(err) {
                        emitter.removeListener(name, eventListener);
                        reject(err);
                    };

                    emitter.once('error', errorListener);
                }

                emitter.once(name, eventListener);
            });
        }

    },{}],11:[function(require,module,exports){
        (function (global){(function (){
            /*
 * Short-circuit auto-detection in the buffer module to avoid a Duktape
 * compatibility issue with __proto__.
 */
            global.TYPED_ARRAY_SUPPORT = true;

            module.exports = require('buffer/');

        }).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

    },{"buffer/":12}],12:[function(require,module,exports){
        (function (Buffer){(function (){
            /*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */
            /* eslint-disable no-proto */

            'use strict'

            var base64 = require('base64-js')
            var ieee754 = require('ieee754')
            var customInspectSymbol =
                (typeof Symbol === 'function' && typeof Symbol['for'] === 'function') // eslint-disable-line dot-notation
                    ? Symbol['for']('nodejs.util.inspect.custom') // eslint-disable-line dot-notation
                    : null

            exports.Buffer = Buffer
            exports.SlowBuffer = SlowBuffer
            exports.INSPECT_MAX_BYTES = 50

            var K_MAX_LENGTH = 0x7fffffff
            exports.kMaxLength = K_MAX_LENGTH

            /**
             * If `Buffer.TYPED_ARRAY_SUPPORT`:
             *   === true    Use Uint8Array implementation (fastest)
             *   === false   Print warning and recommend using `buffer` v4.x which has an Object
             *               implementation (most compatible, even IE6)
             *
             * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
             * Opera 11.6+, iOS 4.2+.
             *
             * We report that the browser does not support typed arrays if the are not subclassable
             * using __proto__. Firefox 4-29 lacks support for adding new properties to `Uint8Array`
             * (See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438). IE 10 lacks support
             * for __proto__ and has a buggy typed array implementation.
             */
            Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport()

            if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' &&
                typeof console.error === 'function') {
                console.error(
                    'This browser lacks typed array (Uint8Array) support which is required by ' +
                    '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.'
                )
            }

            function typedArraySupport () {
                // Can typed array instances can be augmented?
                try {
                    var arr = new Uint8Array(1)
                    var proto = { foo: function () { return 42 } }
                    Object.setPrototypeOf(proto, Uint8Array.prototype)
                    Object.setPrototypeOf(arr, proto)
                    return arr.foo() === 42
                } catch (e) {
                    return false
                }
            }

            Object.defineProperty(Buffer.prototype, 'parent', {
                enumerable: true,
                get: function () {
                    if (!Buffer.isBuffer(this)) return undefined
                    return this.buffer
                }
            })

            Object.defineProperty(Buffer.prototype, 'offset', {
                enumerable: true,
                get: function () {
                    if (!Buffer.isBuffer(this)) return undefined
                    return this.byteOffset
                }
            })

            function createBuffer (length) {
                if (length > K_MAX_LENGTH) {
                    throw new RangeError('The value "' + length + '" is invalid for option "size"')
                }
                // Return an augmented `Uint8Array` instance
                var buf = new Uint8Array(length)
                Object.setPrototypeOf(buf, Buffer.prototype)
                return buf
            }

            /**
             * The Buffer constructor returns instances of `Uint8Array` that have their
             * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
             * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
             * and the `Uint8Array` methods. Square bracket notation works as expected -- it
             * returns a single octet.
             *
             * The `Uint8Array` prototype remains unmodified.
             */

            function Buffer (arg, encodingOrOffset, length) {
                // Common case.
                if (typeof arg === 'number') {
                    if (typeof encodingOrOffset === 'string') {
                        throw new TypeError(
                            'The "string" argument must be of type string. Received type number'
                        )
                    }
                    return allocUnsafe(arg)
                }
                return from(arg, encodingOrOffset, length)
            }

            Buffer.poolSize = 8192 // not used by this implementation

            function from (value, encodingOrOffset, length) {
                if (typeof value === 'string') {
                    return fromString(value, encodingOrOffset)
                }

                if (ArrayBuffer.isView(value)) {
                    return fromArrayView(value)
                }

                if (value == null) {
                    throw new TypeError(
                        'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
                        'or Array-like Object. Received type ' + (typeof value)
                    )
                }

                if (isInstance(value, ArrayBuffer) ||
                    (value && isInstance(value.buffer, ArrayBuffer))) {
                    return fromArrayBuffer(value, encodingOrOffset, length)
                }

                if (typeof SharedArrayBuffer !== 'undefined' &&
                    (isInstance(value, SharedArrayBuffer) ||
                        (value && isInstance(value.buffer, SharedArrayBuffer)))) {
                    return fromArrayBuffer(value, encodingOrOffset, length)
                }

                if (typeof value === 'number') {
                    throw new TypeError(
                        'The "value" argument must not be of type number. Received type number'
                    )
                }

                var valueOf = value.valueOf && value.valueOf()
                if (valueOf != null && valueOf !== value) {
                    return Buffer.from(valueOf, encodingOrOffset, length)
                }

                var b = fromObject(value)
                if (b) return b

                if (typeof Symbol !== 'undefined' && Symbol.toPrimitive != null &&
                    typeof value[Symbol.toPrimitive] === 'function') {
                    return Buffer.from(
                        value[Symbol.toPrimitive]('string'), encodingOrOffset, length
                    )
                }

                throw new TypeError(
                    'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
                    'or Array-like Object. Received type ' + (typeof value)
                )
            }

            /**
             * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
             * if value is a number.
             * Buffer.from(str[, encoding])
             * Buffer.from(array)
             * Buffer.from(buffer)
             * Buffer.from(arrayBuffer[, byteOffset[, length]])
             **/
            Buffer.from = function (value, encodingOrOffset, length) {
                return from(value, encodingOrOffset, length)
            }

// Note: Change prototype *after* Buffer.from is defined to workaround Chrome bug:
// https://github.com/feross/buffer/pull/148
            Object.setPrototypeOf(Buffer.prototype, Uint8Array.prototype)
            Object.setPrototypeOf(Buffer, Uint8Array)

            function assertSize (size) {
                if (typeof size !== 'number') {
                    throw new TypeError('"size" argument must be of type number')
                } else if (size < 0) {
                    throw new RangeError('The value "' + size + '" is invalid for option "size"')
                }
            }

            function alloc (size, fill, encoding) {
                assertSize(size)
                if (size <= 0) {
                    return createBuffer(size)
                }
                if (fill !== undefined) {
                    // Only pay attention to encoding if it's a string. This
                    // prevents accidentally sending in a number that would
                    // be interpreted as a start offset.
                    return typeof encoding === 'string'
                        ? createBuffer(size).fill(fill, encoding)
                        : createBuffer(size).fill(fill)
                }
                return createBuffer(size)
            }

            /**
             * Creates a new filled Buffer instance.
             * alloc(size[, fill[, encoding]])
             **/
            Buffer.alloc = function (size, fill, encoding) {
                return alloc(size, fill, encoding)
            }

            function allocUnsafe (size) {
                assertSize(size)
                return createBuffer(size < 0 ? 0 : checked(size) | 0)
            }

            /**
             * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
             * */
            Buffer.allocUnsafe = function (size) {
                return allocUnsafe(size)
            }
            /**
             * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
             */
            Buffer.allocUnsafeSlow = function (size) {
                return allocUnsafe(size)
            }

            function fromString (string, encoding) {
                if (typeof encoding !== 'string' || encoding === '') {
                    encoding = 'utf8'
                }

                if (!Buffer.isEncoding(encoding)) {
                    throw new TypeError('Unknown encoding: ' + encoding)
                }

                var length = byteLength(string, encoding) | 0
                var buf = createBuffer(length)

                var actual = buf.write(string, encoding)

                if (actual !== length) {
                    // Writing a hex string, for example, that contains invalid characters will
                    // cause everything after the first invalid character to be ignored. (e.g.
                    // 'abxxcd' will be treated as 'ab')
                    buf = buf.slice(0, actual)
                }

                return buf
            }

            function fromArrayLike (array) {
                var length = array.length < 0 ? 0 : checked(array.length) | 0
                var buf = createBuffer(length)
                for (var i = 0; i < length; i += 1) {
                    buf[i] = array[i] & 255
                }
                return buf
            }

            function fromArrayView (arrayView) {
                if (isInstance(arrayView, Uint8Array)) {
                    var copy = new Uint8Array(arrayView)
                    return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength)
                }
                return fromArrayLike(arrayView)
            }

            function fromArrayBuffer (array, byteOffset, length) {
                if (byteOffset < 0 || array.byteLength < byteOffset) {
                    throw new RangeError('"offset" is outside of buffer bounds')
                }

                if (array.byteLength < byteOffset + (length || 0)) {
                    throw new RangeError('"length" is outside of buffer bounds')
                }

                var buf
                if (byteOffset === undefined && length === undefined) {
                    buf = new Uint8Array(array)
                } else if (length === undefined) {
                    buf = new Uint8Array(array, byteOffset)
                } else {
                    buf = new Uint8Array(array, byteOffset, length)
                }

                // Return an augmented `Uint8Array` instance
                Object.setPrototypeOf(buf, Buffer.prototype)

                return buf
            }

            function fromObject (obj) {
                if (Buffer.isBuffer(obj)) {
                    var len = checked(obj.length) | 0
                    var buf = createBuffer(len)

                    if (buf.length === 0) {
                        return buf
                    }

                    obj.copy(buf, 0, 0, len)
                    return buf
                }

                if (obj.length !== undefined) {
                    if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
                        return createBuffer(0)
                    }
                    return fromArrayLike(obj)
                }

                if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
                    return fromArrayLike(obj.data)
                }
            }

            function checked (length) {
                // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
                // length is NaN (which is otherwise coerced to zero.)
                if (length >= K_MAX_LENGTH) {
                    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                        'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
                }
                return length | 0
            }

            function SlowBuffer (length) {
                if (+length != length) { // eslint-disable-line eqeqeq
                    length = 0
                }
                return Buffer.alloc(+length)
            }

            Buffer.isBuffer = function isBuffer (b) {
                return b != null && b._isBuffer === true &&
                    b !== Buffer.prototype // so Buffer.isBuffer(Buffer.prototype) will be false
            }

            Buffer.compare = function compare (a, b) {
                if (isInstance(a, Uint8Array)) a = Buffer.from(a, a.offset, a.byteLength)
                if (isInstance(b, Uint8Array)) b = Buffer.from(b, b.offset, b.byteLength)
                if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
                    throw new TypeError(
                        'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
                    )
                }

                if (a === b) return 0

                var x = a.length
                var y = b.length

                for (var i = 0, len = Math.min(x, y); i < len; ++i) {
                    if (a[i] !== b[i]) {
                        x = a[i]
                        y = b[i]
                        break
                    }
                }

                if (x < y) return -1
                if (y < x) return 1
                return 0
            }

            Buffer.isEncoding = function isEncoding (encoding) {
                switch (String(encoding).toLowerCase()) {
                    case 'hex':
                    case 'utf8':
                    case 'utf-8':
                    case 'ascii':
                    case 'latin1':
                    case 'binary':
                    case 'base64':
                    case 'ucs2':
                    case 'ucs-2':
                    case 'utf16le':
                    case 'utf-16le':
                        return true
                    default:
                        return false
                }
            }

            Buffer.concat = function concat (list, length) {
                if (!Array.isArray(list)) {
                    throw new TypeError('"list" argument must be an Array of Buffers')
                }

                if (list.length === 0) {
                    return Buffer.alloc(0)
                }

                var i
                if (length === undefined) {
                    length = 0
                    for (i = 0; i < list.length; ++i) {
                        length += list[i].length
                    }
                }

                var buffer = Buffer.allocUnsafe(length)
                var pos = 0
                for (i = 0; i < list.length; ++i) {
                    var buf = list[i]
                    if (isInstance(buf, Uint8Array)) {
                        Uint8Array.prototype.set.call(
                            buffer,
                            buf,
                            pos
                        )
                    } else if (!Buffer.isBuffer(buf)) {
                        throw new TypeError('"list" argument must be an Array of Buffers')
                    } else {
                        buf.copy(buffer, pos)
                    }
                    pos += buf.length
                }
                return buffer
            }

            function byteLength (string, encoding) {
                if (Buffer.isBuffer(string)) {
                    return string.length
                }
                if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
                    return string.byteLength
                }
                if (typeof string !== 'string') {
                    throw new TypeError(
                        'The "string" argument must be one of type string, Buffer, or ArrayBuffer. ' +
                        'Received type ' + typeof string
                    )
                }

                var len = string.length
                var mustMatch = (arguments.length > 2 && arguments[2] === true)
                if (!mustMatch && len === 0) return 0

                // Use a for loop to avoid recursion
                var loweredCase = false
                for (;;) {
                    switch (encoding) {
                        case 'ascii':
                        case 'latin1':
                        case 'binary':
                            return len
                        case 'utf8':
                        case 'utf-8':
                            return utf8ToBytes(string).length
                        case 'ucs2':
                        case 'ucs-2':
                        case 'utf16le':
                        case 'utf-16le':
                            return len * 2
                        case 'hex':
                            return len >>> 1
                        case 'base64':
                            return base64ToBytes(string).length
                        default:
                            if (loweredCase) {
                                return mustMatch ? -1 : utf8ToBytes(string).length // assume utf8
                            }
                            encoding = ('' + encoding).toLowerCase()
                            loweredCase = true
                    }
                }
            }
            Buffer.byteLength = byteLength

            function slowToString (encoding, start, end) {
                var loweredCase = false

                // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
                // property of a typed array.

                // This behaves neither like String nor Uint8Array in that we set start/end
                // to their upper/lower bounds if the value passed is out of range.
                // undefined is handled specially as per ECMA-262 6th Edition,
                // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
                if (start === undefined || start < 0) {
                    start = 0
                }
                // Return early if start > this.length. Done here to prevent potential uint32
                // coercion fail below.
                if (start > this.length) {
                    return ''
                }

                if (end === undefined || end > this.length) {
                    end = this.length
                }

                if (end <= 0) {
                    return ''
                }

                // Force coercion to uint32. This will also coerce falsey/NaN values to 0.
                end >>>= 0
                start >>>= 0

                if (end <= start) {
                    return ''
                }

                if (!encoding) encoding = 'utf8'

                while (true) {
                    switch (encoding) {
                        case 'hex':
                            return hexSlice(this, start, end)

                        case 'utf8':
                        case 'utf-8':
                            return utf8Slice(this, start, end)

                        case 'ascii':
                            return asciiSlice(this, start, end)

                        case 'latin1':
                        case 'binary':
                            return latin1Slice(this, start, end)

                        case 'base64':
                            return base64Slice(this, start, end)

                        case 'ucs2':
                        case 'ucs-2':
                        case 'utf16le':
                        case 'utf-16le':
                            return utf16leSlice(this, start, end)

                        default:
                            if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
                            encoding = (encoding + '').toLowerCase()
                            loweredCase = true
                    }
                }
            }

// This property is used by `Buffer.isBuffer` (and the `is-buffer` npm package)
// to detect a Buffer instance. It's not possible to use `instanceof Buffer`
// reliably in a browserify context because there could be multiple different
// copies of the 'buffer' package in use. This method works even for Buffer
// instances that were created from another copy of the `buffer` package.
// See: https://github.com/feross/buffer/issues/154
            Buffer.prototype._isBuffer = true

            function swap (b, n, m) {
                var i = b[n]
                b[n] = b[m]
                b[m] = i
            }

            Buffer.prototype.swap16 = function swap16 () {
                var len = this.length
                if (len % 2 !== 0) {
                    throw new RangeError('Buffer size must be a multiple of 16-bits')
                }
                for (var i = 0; i < len; i += 2) {
                    swap(this, i, i + 1)
                }
                return this
            }

            Buffer.prototype.swap32 = function swap32 () {
                var len = this.length
                if (len % 4 !== 0) {
                    throw new RangeError('Buffer size must be a multiple of 32-bits')
                }
                for (var i = 0; i < len; i += 4) {
                    swap(this, i, i + 3)
                    swap(this, i + 1, i + 2)
                }
                return this
            }

            Buffer.prototype.swap64 = function swap64 () {
                var len = this.length
                if (len % 8 !== 0) {
                    throw new RangeError('Buffer size must be a multiple of 64-bits')
                }
                for (var i = 0; i < len; i += 8) {
                    swap(this, i, i + 7)
                    swap(this, i + 1, i + 6)
                    swap(this, i + 2, i + 5)
                    swap(this, i + 3, i + 4)
                }
                return this
            }

            Buffer.prototype.toString = function toString () {
                var length = this.length
                if (length === 0) return ''
                if (arguments.length === 0) return utf8Slice(this, 0, length)
                return slowToString.apply(this, arguments)
            }

            Buffer.prototype.toLocaleString = Buffer.prototype.toString

            Buffer.prototype.equals = function equals (b) {
                if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
                if (this === b) return true
                return Buffer.compare(this, b) === 0
            }

            Buffer.prototype.inspect = function inspect () {
                var str = ''
                var max = exports.INSPECT_MAX_BYTES
                str = this.toString('hex', 0, max).replace(/(.{2})/g, '$1 ').trim()
                if (this.length > max) str += ' ... '
                return '<Buffer ' + str + '>'
            }
            if (customInspectSymbol) {
                Buffer.prototype[customInspectSymbol] = Buffer.prototype.inspect
            }

            Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
                if (isInstance(target, Uint8Array)) {
                    target = Buffer.from(target, target.offset, target.byteLength)
                }
                if (!Buffer.isBuffer(target)) {
                    throw new TypeError(
                        'The "target" argument must be one of type Buffer or Uint8Array. ' +
                        'Received type ' + (typeof target)
                    )
                }

                if (start === undefined) {
                    start = 0
                }
                if (end === undefined) {
                    end = target ? target.length : 0
                }
                if (thisStart === undefined) {
                    thisStart = 0
                }
                if (thisEnd === undefined) {
                    thisEnd = this.length
                }

                if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
                    throw new RangeError('out of range index')
                }

                if (thisStart >= thisEnd && start >= end) {
                    return 0
                }
                if (thisStart >= thisEnd) {
                    return -1
                }
                if (start >= end) {
                    return 1
                }

                start >>>= 0
                end >>>= 0
                thisStart >>>= 0
                thisEnd >>>= 0

                if (this === target) return 0

                var x = thisEnd - thisStart
                var y = end - start
                var len = Math.min(x, y)

                var thisCopy = this.slice(thisStart, thisEnd)
                var targetCopy = target.slice(start, end)

                for (var i = 0; i < len; ++i) {
                    if (thisCopy[i] !== targetCopy[i]) {
                        x = thisCopy[i]
                        y = targetCopy[i]
                        break
                    }
                }

                if (x < y) return -1
                if (y < x) return 1
                return 0
            }

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
            function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
                // Empty buffer means no match
                if (buffer.length === 0) return -1

                // Normalize byteOffset
                if (typeof byteOffset === 'string') {
                    encoding = byteOffset
                    byteOffset = 0
                } else if (byteOffset > 0x7fffffff) {
                    byteOffset = 0x7fffffff
                } else if (byteOffset < -0x80000000) {
                    byteOffset = -0x80000000
                }
                byteOffset = +byteOffset // Coerce to Number.
                if (numberIsNaN(byteOffset)) {
                    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
                    byteOffset = dir ? 0 : (buffer.length - 1)
                }

                // Normalize byteOffset: negative offsets start from the end of the buffer
                if (byteOffset < 0) byteOffset = buffer.length + byteOffset
                if (byteOffset >= buffer.length) {
                    if (dir) return -1
                    else byteOffset = buffer.length - 1
                } else if (byteOffset < 0) {
                    if (dir) byteOffset = 0
                    else return -1
                }

                // Normalize val
                if (typeof val === 'string') {
                    val = Buffer.from(val, encoding)
                }

                // Finally, search either indexOf (if dir is true) or lastIndexOf
                if (Buffer.isBuffer(val)) {
                    // Special case: looking for empty string/buffer always fails
                    if (val.length === 0) {
                        return -1
                    }
                    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
                } else if (typeof val === 'number') {
                    val = val & 0xFF // Search for a byte value [0-255]
                    if (typeof Uint8Array.prototype.indexOf === 'function') {
                        if (dir) {
                            return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
                        } else {
                            return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
                        }
                    }
                    return arrayIndexOf(buffer, [val], byteOffset, encoding, dir)
                }

                throw new TypeError('val must be string, number or Buffer')
            }

            function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
                var indexSize = 1
                var arrLength = arr.length
                var valLength = val.length

                if (encoding !== undefined) {
                    encoding = String(encoding).toLowerCase()
                    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
                        encoding === 'utf16le' || encoding === 'utf-16le') {
                        if (arr.length < 2 || val.length < 2) {
                            return -1
                        }
                        indexSize = 2
                        arrLength /= 2
                        valLength /= 2
                        byteOffset /= 2
                    }
                }

                function read (buf, i) {
                    if (indexSize === 1) {
                        return buf[i]
                    } else {
                        return buf.readUInt16BE(i * indexSize)
                    }
                }

                var i
                if (dir) {
                    var foundIndex = -1
                    for (i = byteOffset; i < arrLength; i++) {
                        if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
                            if (foundIndex === -1) foundIndex = i
                            if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
                        } else {
                            if (foundIndex !== -1) i -= i - foundIndex
                            foundIndex = -1
                        }
                    }
                } else {
                    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
                    for (i = byteOffset; i >= 0; i--) {
                        var found = true
                        for (var j = 0; j < valLength; j++) {
                            if (read(arr, i + j) !== read(val, j)) {
                                found = false
                                break
                            }
                        }
                        if (found) return i
                    }
                }

                return -1
            }

            Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
                return this.indexOf(val, byteOffset, encoding) !== -1
            }

            Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
                return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
            }

            Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
                return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
            }

            function hexWrite (buf, string, offset, length) {
                offset = Number(offset) || 0
                var remaining = buf.length - offset
                if (!length) {
                    length = remaining
                } else {
                    length = Number(length)
                    if (length > remaining) {
                        length = remaining
                    }
                }

                var strLen = string.length

                if (length > strLen / 2) {
                    length = strLen / 2
                }
                for (var i = 0; i < length; ++i) {
                    var parsed = parseInt(string.substr(i * 2, 2), 16)
                    if (numberIsNaN(parsed)) return i
                    buf[offset + i] = parsed
                }
                return i
            }

            function utf8Write (buf, string, offset, length) {
                return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
            }

            function asciiWrite (buf, string, offset, length) {
                return blitBuffer(asciiToBytes(string), buf, offset, length)
            }

            function base64Write (buf, string, offset, length) {
                return blitBuffer(base64ToBytes(string), buf, offset, length)
            }

            function ucs2Write (buf, string, offset, length) {
                return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
            }

            Buffer.prototype.write = function write (string, offset, length, encoding) {
                // Buffer#write(string)
                if (offset === undefined) {
                    encoding = 'utf8'
                    length = this.length
                    offset = 0
                    // Buffer#write(string, encoding)
                } else if (length === undefined && typeof offset === 'string') {
                    encoding = offset
                    length = this.length
                    offset = 0
                    // Buffer#write(string, offset[, length][, encoding])
                } else if (isFinite(offset)) {
                    offset = offset >>> 0
                    if (isFinite(length)) {
                        length = length >>> 0
                        if (encoding === undefined) encoding = 'utf8'
                    } else {
                        encoding = length
                        length = undefined
                    }
                } else {
                    throw new Error(
                        'Buffer.write(string, encoding, offset[, length]) is no longer supported'
                    )
                }

                var remaining = this.length - offset
                if (length === undefined || length > remaining) length = remaining

                if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
                    throw new RangeError('Attempt to write outside buffer bounds')
                }

                if (!encoding) encoding = 'utf8'

                var loweredCase = false
                for (;;) {
                    switch (encoding) {
                        case 'hex':
                            return hexWrite(this, string, offset, length)

                        case 'utf8':
                        case 'utf-8':
                            return utf8Write(this, string, offset, length)

                        case 'ascii':
                        case 'latin1':
                        case 'binary':
                            return asciiWrite(this, string, offset, length)

                        case 'base64':
                            // Warning: maxLength not taken into account in base64Write
                            return base64Write(this, string, offset, length)

                        case 'ucs2':
                        case 'ucs-2':
                        case 'utf16le':
                        case 'utf-16le':
                            return ucs2Write(this, string, offset, length)

                        default:
                            if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
                            encoding = ('' + encoding).toLowerCase()
                            loweredCase = true
                    }
                }
            }

            Buffer.prototype.toJSON = function toJSON () {
                return {
                    type: 'Buffer',
                    data: Array.prototype.slice.call(this._arr || this, 0)
                }
            }

            function base64Slice (buf, start, end) {
                if (start === 0 && end === buf.length) {
                    return base64.fromByteArray(buf)
                } else {
                    return base64.fromByteArray(buf.slice(start, end))
                }
            }

            function utf8Slice (buf, start, end) {
                end = Math.min(buf.length, end)
                var res = []

                var i = start
                while (i < end) {
                    var firstByte = buf[i]
                    var codePoint = null
                    var bytesPerSequence = (firstByte > 0xEF)
                        ? 4
                        : (firstByte > 0xDF)
                            ? 3
                            : (firstByte > 0xBF)
                                ? 2
                                : 1

                    if (i + bytesPerSequence <= end) {
                        var secondByte, thirdByte, fourthByte, tempCodePoint

                        switch (bytesPerSequence) {
                            case 1:
                                if (firstByte < 0x80) {
                                    codePoint = firstByte
                                }
                                break
                            case 2:
                                secondByte = buf[i + 1]
                                if ((secondByte & 0xC0) === 0x80) {
                                    tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
                                    if (tempCodePoint > 0x7F) {
                                        codePoint = tempCodePoint
                                    }
                                }
                                break
                            case 3:
                                secondByte = buf[i + 1]
                                thirdByte = buf[i + 2]
                                if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
                                    tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
                                    if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
                                        codePoint = tempCodePoint
                                    }
                                }
                                break
                            case 4:
                                secondByte = buf[i + 1]
                                thirdByte = buf[i + 2]
                                fourthByte = buf[i + 3]
                                if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
                                    tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
                                    if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
                                        codePoint = tempCodePoint
                                    }
                                }
                        }
                    }

                    if (codePoint === null) {
                        // we did not generate a valid codePoint so insert a
                        // replacement char (U+FFFD) and advance only 1 byte
                        codePoint = 0xFFFD
                        bytesPerSequence = 1
                    } else if (codePoint > 0xFFFF) {
                        // encode to utf16 (surrogate pair dance)
                        codePoint -= 0x10000
                        res.push(codePoint >>> 10 & 0x3FF | 0xD800)
                        codePoint = 0xDC00 | codePoint & 0x3FF
                    }

                    res.push(codePoint)
                    i += bytesPerSequence
                }

                return decodeCodePointsArray(res)
            }

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
            var MAX_ARGUMENTS_LENGTH = 0x1000

            function decodeCodePointsArray (codePoints) {
                var len = codePoints.length
                if (len <= MAX_ARGUMENTS_LENGTH) {
                    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
                }

                // Decode in chunks to avoid "call stack size exceeded".
                var res = ''
                var i = 0
                while (i < len) {
                    res += String.fromCharCode.apply(
                        String,
                        codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
                    )
                }
                return res
            }

            function asciiSlice (buf, start, end) {
                var ret = ''
                end = Math.min(buf.length, end)

                for (var i = start; i < end; ++i) {
                    ret += String.fromCharCode(buf[i] & 0x7F)
                }
                return ret
            }

            function latin1Slice (buf, start, end) {
                var ret = ''
                end = Math.min(buf.length, end)

                for (var i = start; i < end; ++i) {
                    ret += String.fromCharCode(buf[i])
                }
                return ret
            }

            function hexSlice (buf, start, end) {
                var len = buf.length

                if (!start || start < 0) start = 0
                if (!end || end < 0 || end > len) end = len

                var out = ''
                for (var i = start; i < end; ++i) {
                    out += hexSliceLookupTable[buf[i]]
                }
                return out
            }

            function utf16leSlice (buf, start, end) {
                var bytes = buf.slice(start, end)
                var res = ''
                // If bytes.length is odd, the last 8 bits must be ignored (same as node.js)
                for (var i = 0; i < bytes.length - 1; i += 2) {
                    res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
                }
                return res
            }

            Buffer.prototype.slice = function slice (start, end) {
                var len = this.length
                start = ~~start
                end = end === undefined ? len : ~~end

                if (start < 0) {
                    start += len
                    if (start < 0) start = 0
                } else if (start > len) {
                    start = len
                }

                if (end < 0) {
                    end += len
                    if (end < 0) end = 0
                } else if (end > len) {
                    end = len
                }

                if (end < start) end = start

                var newBuf = this.subarray(start, end)
                // Return an augmented `Uint8Array` instance
                Object.setPrototypeOf(newBuf, Buffer.prototype)

                return newBuf
            }

            /*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
            function checkOffset (offset, ext, length) {
                if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
                if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
            }

            Buffer.prototype.readUintLE =
                Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
                    offset = offset >>> 0
                    byteLength = byteLength >>> 0
                    if (!noAssert) checkOffset(offset, byteLength, this.length)

                    var val = this[offset]
                    var mul = 1
                    var i = 0
                    while (++i < byteLength && (mul *= 0x100)) {
                        val += this[offset + i] * mul
                    }

                    return val
                }

            Buffer.prototype.readUintBE =
                Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
                    offset = offset >>> 0
                    byteLength = byteLength >>> 0
                    if (!noAssert) {
                        checkOffset(offset, byteLength, this.length)
                    }

                    var val = this[offset + --byteLength]
                    var mul = 1
                    while (byteLength > 0 && (mul *= 0x100)) {
                        val += this[offset + --byteLength] * mul
                    }

                    return val
                }

            Buffer.prototype.readUint8 =
                Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
                    offset = offset >>> 0
                    if (!noAssert) checkOffset(offset, 1, this.length)
                    return this[offset]
                }

            Buffer.prototype.readUint16LE =
                Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
                    offset = offset >>> 0
                    if (!noAssert) checkOffset(offset, 2, this.length)
                    return this[offset] | (this[offset + 1] << 8)
                }

            Buffer.prototype.readUint16BE =
                Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
                    offset = offset >>> 0
                    if (!noAssert) checkOffset(offset, 2, this.length)
                    return (this[offset] << 8) | this[offset + 1]
                }

            Buffer.prototype.readUint32LE =
                Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
                    offset = offset >>> 0
                    if (!noAssert) checkOffset(offset, 4, this.length)

                    return ((this[offset]) |
                            (this[offset + 1] << 8) |
                            (this[offset + 2] << 16)) +
                        (this[offset + 3] * 0x1000000)
                }

            Buffer.prototype.readUint32BE =
                Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
                    offset = offset >>> 0
                    if (!noAssert) checkOffset(offset, 4, this.length)

                    return (this[offset] * 0x1000000) +
                        ((this[offset + 1] << 16) |
                            (this[offset + 2] << 8) |
                            this[offset + 3])
                }

            Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
                offset = offset >>> 0
                byteLength = byteLength >>> 0
                if (!noAssert) checkOffset(offset, byteLength, this.length)

                var val = this[offset]
                var mul = 1
                var i = 0
                while (++i < byteLength && (mul *= 0x100)) {
                    val += this[offset + i] * mul
                }
                mul *= 0x80

                if (val >= mul) val -= Math.pow(2, 8 * byteLength)

                return val
            }

            Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
                offset = offset >>> 0
                byteLength = byteLength >>> 0
                if (!noAssert) checkOffset(offset, byteLength, this.length)

                var i = byteLength
                var mul = 1
                var val = this[offset + --i]
                while (i > 0 && (mul *= 0x100)) {
                    val += this[offset + --i] * mul
                }
                mul *= 0x80

                if (val >= mul) val -= Math.pow(2, 8 * byteLength)

                return val
            }

            Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
                offset = offset >>> 0
                if (!noAssert) checkOffset(offset, 1, this.length)
                if (!(this[offset] & 0x80)) return (this[offset])
                return ((0xff - this[offset] + 1) * -1)
            }

            Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
                offset = offset >>> 0
                if (!noAssert) checkOffset(offset, 2, this.length)
                var val = this[offset] | (this[offset + 1] << 8)
                return (val & 0x8000) ? val | 0xFFFF0000 : val
            }

            Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
                offset = offset >>> 0
                if (!noAssert) checkOffset(offset, 2, this.length)
                var val = this[offset + 1] | (this[offset] << 8)
                return (val & 0x8000) ? val | 0xFFFF0000 : val
            }

            Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
                offset = offset >>> 0
                if (!noAssert) checkOffset(offset, 4, this.length)

                return (this[offset]) |
                    (this[offset + 1] << 8) |
                    (this[offset + 2] << 16) |
                    (this[offset + 3] << 24)
            }

            Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
                offset = offset >>> 0
                if (!noAssert) checkOffset(offset, 4, this.length)

                return (this[offset] << 24) |
                    (this[offset + 1] << 16) |
                    (this[offset + 2] << 8) |
                    (this[offset + 3])
            }

            Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
                offset = offset >>> 0
                if (!noAssert) checkOffset(offset, 4, this.length)
                return ieee754.read(this, offset, true, 23, 4)
            }

            Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
                offset = offset >>> 0
                if (!noAssert) checkOffset(offset, 4, this.length)
                return ieee754.read(this, offset, false, 23, 4)
            }

            Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
                offset = offset >>> 0
                if (!noAssert) checkOffset(offset, 8, this.length)
                return ieee754.read(this, offset, true, 52, 8)
            }

            Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
                offset = offset >>> 0
                if (!noAssert) checkOffset(offset, 8, this.length)
                return ieee754.read(this, offset, false, 52, 8)
            }

            function checkInt (buf, value, offset, ext, max, min) {
                if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
                if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
                if (offset + ext > buf.length) throw new RangeError('Index out of range')
            }

            Buffer.prototype.writeUintLE =
                Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
                    value = +value
                    offset = offset >>> 0
                    byteLength = byteLength >>> 0
                    if (!noAssert) {
                        var maxBytes = Math.pow(2, 8 * byteLength) - 1
                        checkInt(this, value, offset, byteLength, maxBytes, 0)
                    }

                    var mul = 1
                    var i = 0
                    this[offset] = value & 0xFF
                    while (++i < byteLength && (mul *= 0x100)) {
                        this[offset + i] = (value / mul) & 0xFF
                    }

                    return offset + byteLength
                }

            Buffer.prototype.writeUintBE =
                Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
                    value = +value
                    offset = offset >>> 0
                    byteLength = byteLength >>> 0
                    if (!noAssert) {
                        var maxBytes = Math.pow(2, 8 * byteLength) - 1
                        checkInt(this, value, offset, byteLength, maxBytes, 0)
                    }

                    var i = byteLength - 1
                    var mul = 1
                    this[offset + i] = value & 0xFF
                    while (--i >= 0 && (mul *= 0x100)) {
                        this[offset + i] = (value / mul) & 0xFF
                    }

                    return offset + byteLength
                }

            Buffer.prototype.writeUint8 =
                Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
                    value = +value
                    offset = offset >>> 0
                    if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
                    this[offset] = (value & 0xff)
                    return offset + 1
                }

            Buffer.prototype.writeUint16LE =
                Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
                    value = +value
                    offset = offset >>> 0
                    if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
                    this[offset] = (value & 0xff)
                    this[offset + 1] = (value >>> 8)
                    return offset + 2
                }

            Buffer.prototype.writeUint16BE =
                Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
                    value = +value
                    offset = offset >>> 0
                    if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
                    this[offset] = (value >>> 8)
                    this[offset + 1] = (value & 0xff)
                    return offset + 2
                }

            Buffer.prototype.writeUint32LE =
                Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
                    value = +value
                    offset = offset >>> 0
                    if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
                    this[offset + 3] = (value >>> 24)
                    this[offset + 2] = (value >>> 16)
                    this[offset + 1] = (value >>> 8)
                    this[offset] = (value & 0xff)
                    return offset + 4
                }

            Buffer.prototype.writeUint32BE =
                Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
                    value = +value
                    offset = offset >>> 0
                    if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
                    this[offset] = (value >>> 24)
                    this[offset + 1] = (value >>> 16)
                    this[offset + 2] = (value >>> 8)
                    this[offset + 3] = (value & 0xff)
                    return offset + 4
                }

            Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
                value = +value
                offset = offset >>> 0
                if (!noAssert) {
                    var limit = Math.pow(2, (8 * byteLength) - 1)

                    checkInt(this, value, offset, byteLength, limit - 1, -limit)
                }

                var i = 0
                var mul = 1
                var sub = 0
                this[offset] = value & 0xFF
                while (++i < byteLength && (mul *= 0x100)) {
                    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
                        sub = 1
                    }
                    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
                }

                return offset + byteLength
            }

            Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
                value = +value
                offset = offset >>> 0
                if (!noAssert) {
                    var limit = Math.pow(2, (8 * byteLength) - 1)

                    checkInt(this, value, offset, byteLength, limit - 1, -limit)
                }

                var i = byteLength - 1
                var mul = 1
                var sub = 0
                this[offset + i] = value & 0xFF
                while (--i >= 0 && (mul *= 0x100)) {
                    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
                        sub = 1
                    }
                    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
                }

                return offset + byteLength
            }

            Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
                value = +value
                offset = offset >>> 0
                if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
                if (value < 0) value = 0xff + value + 1
                this[offset] = (value & 0xff)
                return offset + 1
            }

            Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
                value = +value
                offset = offset >>> 0
                if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
                this[offset] = (value & 0xff)
                this[offset + 1] = (value >>> 8)
                return offset + 2
            }

            Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
                value = +value
                offset = offset >>> 0
                if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
                this[offset] = (value >>> 8)
                this[offset + 1] = (value & 0xff)
                return offset + 2
            }

            Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
                value = +value
                offset = offset >>> 0
                if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
                this[offset] = (value & 0xff)
                this[offset + 1] = (value >>> 8)
                this[offset + 2] = (value >>> 16)
                this[offset + 3] = (value >>> 24)
                return offset + 4
            }

            Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
                value = +value
                offset = offset >>> 0
                if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
                if (value < 0) value = 0xffffffff + value + 1
                this[offset] = (value >>> 24)
                this[offset + 1] = (value >>> 16)
                this[offset + 2] = (value >>> 8)
                this[offset + 3] = (value & 0xff)
                return offset + 4
            }

            function checkIEEE754 (buf, value, offset, ext, max, min) {
                if (offset + ext > buf.length) throw new RangeError('Index out of range')
                if (offset < 0) throw new RangeError('Index out of range')
            }

            function writeFloat (buf, value, offset, littleEndian, noAssert) {
                value = +value
                offset = offset >>> 0
                if (!noAssert) {
                    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
                }
                ieee754.write(buf, value, offset, littleEndian, 23, 4)
                return offset + 4
            }

            Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
                return writeFloat(this, value, offset, true, noAssert)
            }

            Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
                return writeFloat(this, value, offset, false, noAssert)
            }

            function writeDouble (buf, value, offset, littleEndian, noAssert) {
                value = +value
                offset = offset >>> 0
                if (!noAssert) {
                    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
                }
                ieee754.write(buf, value, offset, littleEndian, 52, 8)
                return offset + 8
            }

            Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
                return writeDouble(this, value, offset, true, noAssert)
            }

            Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
                return writeDouble(this, value, offset, false, noAssert)
            }

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
            Buffer.prototype.copy = function copy (target, targetStart, start, end) {
                if (!Buffer.isBuffer(target)) throw new TypeError('argument should be a Buffer')
                if (!start) start = 0
                if (!end && end !== 0) end = this.length
                if (targetStart >= target.length) targetStart = target.length
                if (!targetStart) targetStart = 0
                if (end > 0 && end < start) end = start

                // Copy 0 bytes; we're done
                if (end === start) return 0
                if (target.length === 0 || this.length === 0) return 0

                // Fatal error conditions
                if (targetStart < 0) {
                    throw new RangeError('targetStart out of bounds')
                }
                if (start < 0 || start >= this.length) throw new RangeError('Index out of range')
                if (end < 0) throw new RangeError('sourceEnd out of bounds')

                // Are we oob?
                if (end > this.length) end = this.length
                if (target.length - targetStart < end - start) {
                    end = target.length - targetStart + start
                }

                var len = end - start

                if (this === target && typeof Uint8Array.prototype.copyWithin === 'function') {
                    // Use built-in when available, missing from IE11
                    this.copyWithin(targetStart, start, end)
                } else {
                    Uint8Array.prototype.set.call(
                        target,
                        this.subarray(start, end),
                        targetStart
                    )
                }

                return len
            }

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
            Buffer.prototype.fill = function fill (val, start, end, encoding) {
                // Handle string cases:
                if (typeof val === 'string') {
                    if (typeof start === 'string') {
                        encoding = start
                        start = 0
                        end = this.length
                    } else if (typeof end === 'string') {
                        encoding = end
                        end = this.length
                    }
                    if (encoding !== undefined && typeof encoding !== 'string') {
                        throw new TypeError('encoding must be a string')
                    }
                    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
                        throw new TypeError('Unknown encoding: ' + encoding)
                    }
                    if (val.length === 1) {
                        var code = val.charCodeAt(0)
                        if ((encoding === 'utf8' && code < 128) ||
                            encoding === 'latin1') {
                            // Fast path: If `val` fits into a single byte, use that numeric value.
                            val = code
                        }
                    }
                } else if (typeof val === 'number') {
                    val = val & 255
                } else if (typeof val === 'boolean') {
                    val = Number(val)
                }

                // Invalid ranges are not set to a default, so can range check early.
                if (start < 0 || this.length < start || this.length < end) {
                    throw new RangeError('Out of range index')
                }

                if (end <= start) {
                    return this
                }

                start = start >>> 0
                end = end === undefined ? this.length : end >>> 0

                if (!val) val = 0

                var i
                if (typeof val === 'number') {
                    for (i = start; i < end; ++i) {
                        this[i] = val
                    }
                } else {
                    var bytes = Buffer.isBuffer(val)
                        ? val
                        : Buffer.from(val, encoding)
                    var len = bytes.length
                    if (len === 0) {
                        throw new TypeError('The value "' + val +
                            '" is invalid for argument "value"')
                    }
                    for (i = 0; i < end - start; ++i) {
                        this[i + start] = bytes[i % len]
                    }
                }

                return this
            }

// HELPER FUNCTIONS
// ================

            var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g

            function base64clean (str) {
                // Node takes equal signs as end of the Base64 encoding
                str = str.split('=')[0]
                // Node strips out invalid characters like \n and \t from the string, base64-js does not
                str = str.trim().replace(INVALID_BASE64_RE, '')
                // Node converts strings with length < 2 to ''
                if (str.length < 2) return ''
                // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
                while (str.length % 4 !== 0) {
                    str = str + '='
                }
                return str
            }

            function utf8ToBytes (string, units) {
                units = units || Infinity
                var codePoint
                var length = string.length
                var leadSurrogate = null
                var bytes = []

                for (var i = 0; i < length; ++i) {
                    codePoint = string.charCodeAt(i)

                    // is surrogate component
                    if (codePoint > 0xD7FF && codePoint < 0xE000) {
                        // last char was a lead
                        if (!leadSurrogate) {
                            // no lead yet
                            if (codePoint > 0xDBFF) {
                                // unexpected trail
                                if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
                                continue
                            } else if (i + 1 === length) {
                                // unpaired lead
                                if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
                                continue
                            }

                            // valid lead
                            leadSurrogate = codePoint

                            continue
                        }

                        // 2 leads in a row
                        if (codePoint < 0xDC00) {
                            if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
                            leadSurrogate = codePoint
                            continue
                        }

                        // valid surrogate pair
                        codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
                    } else if (leadSurrogate) {
                        // valid bmp char, but last char was a lead
                        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
                    }

                    leadSurrogate = null

                    // encode utf8
                    if (codePoint < 0x80) {
                        if ((units -= 1) < 0) break
                        bytes.push(codePoint)
                    } else if (codePoint < 0x800) {
                        if ((units -= 2) < 0) break
                        bytes.push(
                            codePoint >> 0x6 | 0xC0,
                            codePoint & 0x3F | 0x80
                        )
                    } else if (codePoint < 0x10000) {
                        if ((units -= 3) < 0) break
                        bytes.push(
                            codePoint >> 0xC | 0xE0,
                            codePoint >> 0x6 & 0x3F | 0x80,
                            codePoint & 0x3F | 0x80
                        )
                    } else if (codePoint < 0x110000) {
                        if ((units -= 4) < 0) break
                        bytes.push(
                            codePoint >> 0x12 | 0xF0,
                            codePoint >> 0xC & 0x3F | 0x80,
                            codePoint >> 0x6 & 0x3F | 0x80,
                            codePoint & 0x3F | 0x80
                        )
                    } else {
                        throw new Error('Invalid code point')
                    }
                }

                return bytes
            }

            function asciiToBytes (str) {
                var byteArray = []
                for (var i = 0; i < str.length; ++i) {
                    // Node's code seems to be doing this and not & 0x7F..
                    byteArray.push(str.charCodeAt(i) & 0xFF)
                }
                return byteArray
            }

            function utf16leToBytes (str, units) {
                var c, hi, lo
                var byteArray = []
                for (var i = 0; i < str.length; ++i) {
                    if ((units -= 2) < 0) break

                    c = str.charCodeAt(i)
                    hi = c >> 8
                    lo = c % 256
                    byteArray.push(lo)
                    byteArray.push(hi)
                }

                return byteArray
            }

            function base64ToBytes (str) {
                return base64.toByteArray(base64clean(str))
            }

            function blitBuffer (src, dst, offset, length) {
                for (var i = 0; i < length; ++i) {
                    if ((i + offset >= dst.length) || (i >= src.length)) break
                    dst[i + offset] = src[i]
                }
                return i
            }

// ArrayBuffer or Uint8Array objects from other contexts (i.e. iframes) do not pass
// the `instanceof` check but they should be treated as of that type.
// See: https://github.com/feross/buffer/issues/166
            function isInstance (obj, type) {
                return obj instanceof type ||
                    (obj != null && obj.constructor != null && obj.constructor.name != null &&
                        obj.constructor.name === type.name)
            }
            function numberIsNaN (obj) {
                // For IE11 support
                return obj !== obj // eslint-disable-line no-self-compare
            }

// Create lookup table for `toString('hex')`
// See: https://github.com/feross/buffer/issues/219
            var hexSliceLookupTable = (function () {
                var alphabet = '0123456789abcdef'
                var table = new Array(256)
                for (var i = 0; i < 16; ++i) {
                    var i16 = i * 16
                    for (var j = 0; j < 16; ++j) {
                        table[i16 + j] = alphabet[i] + alphabet[j]
                    }
                }
                return table
            })()

        }).call(this)}).call(this,require("buffer").Buffer)

    },{"base64-js":8,"buffer":11,"ieee754":15}],13:[function(require,module,exports){
        (function (process,Buffer){(function (){
            const stream = require('stream');

            const {platform, pointerSize} = Process;

            const universalConstants = {
                S_IFMT: 0xf000,
                S_IFREG: 0x8000,
                S_IFDIR: 0x4000,
                S_IFCHR: 0x2000,
                S_IFBLK: 0x6000,
                S_IFIFO: 0x1000,
                S_IFLNK: 0xa000,
                S_IFSOCK: 0xc000,

                S_IRWXU: 448,
                S_IRUSR: 256,
                S_IWUSR: 128,
                S_IXUSR: 64,
                S_IRWXG: 56,
                S_IRGRP: 32,
                S_IWGRP: 16,
                S_IXGRP: 8,
                S_IRWXO: 7,
                S_IROTH: 4,
                S_IWOTH: 2,
                S_IXOTH: 1,

                DT_UNKNOWN: 0,
                DT_FIFO: 1,
                DT_CHR: 2,
                DT_DIR: 4,
                DT_BLK: 6,
                DT_REG: 8,
                DT_LNK: 10,
                DT_SOCK: 12,
                DT_WHT: 14,
            };
            const platformConstants = {
                darwin: {
                    O_RDONLY: 0x0,
                    O_WRONLY: 0x1,
                    O_RDWR: 0x2,
                    O_CREAT: 0x200,
                    O_EXCL: 0x800,
                    O_NOCTTY: 0x20000,
                    O_TRUNC: 0x400,
                    O_APPEND: 0x8,
                    O_DIRECTORY: 0x100000,
                    O_NOFOLLOW: 0x100,
                    O_SYNC: 0x80,
                    O_DSYNC: 0x400000,
                    O_SYMLINK: 0x200000,
                    O_NONBLOCK: 0x4,
                },
                linux: {
                    O_RDONLY: 0x0,
                    O_WRONLY: 0x1,
                    O_RDWR: 0x2,
                    O_CREAT: 0x40,
                    O_EXCL: 0x80,
                    O_NOCTTY: 0x100,
                    O_TRUNC: 0x200,
                    O_APPEND: 0x400,
                    O_DIRECTORY: 0x10000,
                    O_NOATIME: 0x40000,
                    O_NOFOLLOW: 0x20000,
                    O_SYNC: 0x101000,
                    O_DSYNC: 0x1000,
                    O_DIRECT: 0x4000,
                    O_NONBLOCK: 0x800,
                },
            };
            const constants = Object.assign({}, universalConstants, platformConstants[platform] || {});

            const SEEK_SET = 0;
            const SEEK_CUR = 1;
            const SEEK_END = 2;

            const EINTR = 4;

            class ReadStream extends stream.Readable {
                constructor(path) {
                    super({
                        highWaterMark: 4 * 1024 * 1024
                    });

                    this._input = null;
                    this._readRequest = null;

                    const pathStr = Memory.allocUtf8String(path);
                    const fd = getApi().open(pathStr, constants.O_RDONLY, 0);
                    if (fd.value === -1) {
                        this.emit('error', new Error(`Unable to open file (${getErrorString(fd.errno)})`));
                        this.push(null);
                        return;
                    }

                    this._input = new UnixInputStream(fd.value, { autoClose: true });
                }

                _read(size) {
                    if (this._readRequest !== null)
                        return;

                    this._readRequest = this._input.read(size)
                        .then(buffer => {
                            this._readRequest = null;

                            if (buffer.byteLength === 0) {
                                this._closeInput();
                                this.push(null);
                                return;
                            }

                            if (this.push(Buffer.from(buffer)))
                                this._read(size);
                        })
                        .catch(error => {
                            this._readRequest = null;
                            this._closeInput();
                            this.push(null);
                        });
                }

                _closeInput() {
                    if (this._input !== null) {
                        this._input.close();
                        this._input = null;
                    }
                }
            }

            class WriteStream extends stream.Writable {
                constructor(path) {
                    super({
                        highWaterMark: 4 * 1024 * 1024
                    });

                    this._output = null;
                    this._writeRequest = null;

                    const pathStr = Memory.allocUtf8String(path);
                    const flags = constants.O_WRONLY | constants.O_CREAT;
                    const mode = constants.S_IRUSR | constants.S_IWUSR | constants.S_IRGRP | constants.S_IROTH;
                    const fd = getApi().open(pathStr, flags, mode);
                    if (fd.value === -1) {
                        this.emit('error', new Error(`Unable to open file (${getErrorString(fd.errno)})`));
                        this.push(null);
                        return;
                    }

                    this._output = new UnixOutputStream(fd.value, { autoClose: true });
                    this.on('finish', () => this._closeOutput());
                    this.on('error', () => this._closeOutput());
                }

                _write(chunk, encoding, callback) {
                    if (this._writeRequest !== null)
                        return;

                    this._writeRequest = this._output.writeAll(chunk)
                        .then(size => {
                            this._writeRequest = null;

                            callback();
                        })
                        .catch(error => {
                            this._writeRequest = null;

                            callback(error);
                        });
                }

                _closeOutput() {
                    if (this._output !== null) {
                        this._output.close();
                        this._output = null;
                    }
                }
            }

            const direntSpecs = {
                'linux-32': {
                    'd_name': [11, 'Utf8String'],
                    'd_type': [10, 'U8']
                },
                'linux-64': {
                    'd_name': [19, 'Utf8String'],
                    'd_type': [18, 'U8']
                },
                'darwin-32': {
                    'd_name': [21, 'Utf8String'],
                    'd_type': [20, 'U8']
                },
                'darwin-64': {
                    'd_name': [21, 'Utf8String'],
                    'd_type': [20, 'U8']
                }
            };

            const direntSpec = direntSpecs[`${platform}-${pointerSize * 8}`];

            function readdirSync(path) {
                const entries = [];
                enumerateDirectoryEntries(path, entry => {
                    const name = readDirentField(entry, 'd_name');
                    entries.push(name);
                });
                return entries;
            }

            function list(path) {
                const entries = [];
                enumerateDirectoryEntries(path, entry => {
                    entries.push({
                        name: readDirentField(entry, 'd_name'),
                        type: readDirentField(entry, 'd_type')
                    });
                });
                return entries;
            }

            function enumerateDirectoryEntries(path, callback) {
                const {opendir, opendir$INODE64, closedir, readdir, readdir$INODE64} = getApi();

                const opendirImpl = opendir$INODE64 || opendir;
                const readdirImpl = readdir$INODE64 || readdir;

                const dir = opendirImpl(Memory.allocUtf8String(path));
                const dirHandle = dir.value;
                if (dirHandle.isNull())
                    throw new Error(`Unable to open directory (${getErrorString(dir.errno)})`);

                try {
                    let entry;
                    while (!((entry = readdirImpl(dirHandle)).isNull())) {
                        callback(entry);
                    }
                } finally {
                    closedir(dirHandle);
                }
            }

            function readDirentField(entry, name) {
                const [offset, type] = direntSpec[name];

                const read = (typeof type === 'string') ? Memory['read' + type] : type;

                const value = read(entry.add(offset));
                if (value instanceof Int64 || value instanceof UInt64)
                    return value.valueOf();

                return value;
            }

            function readFileSync(path, options = {}) {
                if (typeof options === 'string')
                    options = { encoding: options };
                const {encoding = null} = options;

                const {open, close, lseek, read} = getApi();

                const pathStr = Memory.allocUtf8String(path);
                const openResult = open(pathStr, constants.O_RDONLY, 0);
                const fd = openResult.value;
                if (fd === -1)
                    throw new Error(`Unable to open file (${getErrorString(openResult.errno)})`);

                try {
                    const fileSize = lseek(fd, 0, SEEK_END).valueOf();

                    lseek(fd, 0, SEEK_SET);

                    const buf = Memory.alloc(fileSize);
                    let readResult, n, readFailed;
                    do {
                        readResult = read(fd, buf, fileSize);
                        n = readResult.value.valueOf();
                        readFailed = n === -1;
                    } while (readFailed && readResult.errno === EINTR);

                    if (readFailed)
                        throw new Error(`Unable to read ${path} (${getErrorString(readResult.errno)})`);

                    if (n !== fileSize.valueOf())
                        throw new Error('Short read');

                    if (encoding === 'utf8') {
                        return buf.readUtf8String(fileSize);
                    }

                    const value = Buffer.from(buf.readByteArray(fileSize));
                    if (encoding !== null) {
                        return value.toString(encoding);
                    }

                    return value;
                } finally {
                    close(fd);
                }
            }

            function readlinkSync(path) {
                const api = getApi();

                const pathStr = Memory.allocUtf8String(path);

                const linkSize = lstatSync(path).size.valueOf();
                const buf = Memory.alloc(linkSize);

                const result = api.readlink(pathStr, buf, linkSize);
                const n = result.value.valueOf();
                if (n === -1)
                    throw new Error(`Unable to read link (${getErrorString(result.errno)})`);

                return buf.readUtf8String(n);
            }

            function unlinkSync(path) {
                const {unlink} = getApi();

                const pathStr = Memory.allocUtf8String(path);

                const result = unlink(pathStr);
                if (result.value === -1)
                    throw new Error(`Unable to unlink (${getErrorString(result.errno)})`);
            }

            const statFields = new Set([
                'dev',
                'mode',
                'nlink',
                'uid',
                'gid',
                'rdev',
                'blksize',
                'ino',
                'size',
                'blocks',
                'atimeMs',
                'mtimeMs',
                'ctimeMs',
                'birthtimeMs',
                'atime',
                'mtime',
                'ctime',
                'birthtime',
            ]);
            const statSpecs = {
                'darwin-32': {
                    size: 108,
                    fields: {
                        'dev': [ 0, 'S32' ],
                        'mode': [ 4, 'U16' ],
                        'nlink': [ 6, 'U16' ],
                        'ino': [ 8, 'U64' ],
                        'uid': [ 16, 'U32' ],
                        'gid': [ 20, 'U32' ],
                        'rdev': [ 24, 'S32' ],
                        'atime': [ 28, readTimespec32 ],
                        'mtime': [ 36, readTimespec32 ],
                        'ctime': [ 44, readTimespec32 ],
                        'birthtime': [ 52, readTimespec32 ],
                        'size': [ 60, 'S64' ],
                        'blocks': [ 68, 'S64' ],
                        'blksize': [ 76, 'S32' ],
                    }
                },
                'darwin-64': {
                    size: 144,
                    fields: {
                        'dev': [ 0, 'S32' ],
                        'mode': [ 4, 'U16' ],
                        'nlink': [ 6, 'U16' ],
                        'ino': [ 8, 'U64' ],
                        'uid': [ 16, 'U32' ],
                        'gid': [ 20, 'U32' ],
                        'rdev': [ 24, 'S32' ],
                        'atime': [ 32, readTimespec64 ],
                        'mtime': [ 48, readTimespec64 ],
                        'ctime': [ 64, readTimespec64 ],
                        'birthtime': [ 80, readTimespec64 ],
                        'size': [ 96, 'S64' ],
                        'blocks': [ 104, 'S64' ],
                        'blksize': [ 112, 'S32' ],
                    }
                },
                'linux-32': {
                    size: 88,
                    fields: {
                        'dev': [ 0, 'U64' ],
                        'mode': [ 16, 'U32' ],
                        'nlink': [ 20, 'U32' ],
                        'ino': [ 12, 'U32' ],
                        'uid': [ 24, 'U32' ],
                        'gid': [ 28, 'U32' ],
                        'rdev': [ 32, 'U64' ],
                        'atime': [ 56, readTimespec32 ],
                        'mtime': [ 64, readTimespec32 ],
                        'ctime': [ 72, readTimespec32 ],
                        'size': [ 44, 'S32' ],
                        'blocks': [ 52, 'S32' ],
                        'blksize': [ 48, 'S32' ],
                    }
                },
                'linux-64': {
                    size: 144,
                    fields: {
                        'dev': [ 0, 'U64' ],
                        'mode': [ 24, 'U32' ],
                        'nlink': [ 16, 'U64' ],
                        'ino': [ 8, 'U64' ],
                        'uid': [ 28, 'U32' ],
                        'gid': [ 32, 'U32' ],
                        'rdev': [ 40, 'U64' ],
                        'atime': [ 72, readTimespec64 ],
                        'mtime': [ 88, readTimespec64 ],
                        'ctime': [ 104, readTimespec64 ],
                        'size': [ 48, 'S64' ],
                        'blocks': [ 64, 'S64' ],
                        'blksize': [ 56, 'S64' ],
                    },
                },
            };
            const statSpec = statSpecs[`${platform}-${pointerSize * 8}`] || null;
            const statBufSize = 256;

            function Stats() {
            }

            function statSync(path) {
                const api = getApi();
                const impl = api.stat64 || api.stat;
                return performStat(impl, path);
            }

            function lstatSync(path) {
                const api = getApi();
                const impl = api.lstat64 || api.lstat;
                return performStat(impl, path);
            }

            function performStat(impl, path) {
                if (statSpec === null)
                    throw new Error('Current OS is not yet supported; please open a PR');

                const buf = Memory.alloc(statBufSize);
                const result = impl(Memory.allocUtf8String(path), buf);
                if (result.value !== 0)
                    throw new Error(`Unable to stat ${path} (${getErrorString(result.errno)})`);

                return new Proxy(new Stats(), {
                    has(target, property) {
                        return statsHasField(property);
                    },
                    get(target, property, receiver) {
                        switch (property) {
                            case 'prototype':
                            case 'constructor':
                            case 'toString':
                                return target[property];
                            case 'hasOwnProperty':
                                return statsHasField;
                            case 'valueOf':
                                return receiver;
                            case 'buffer':
                                return buf;
                            default:
                                const value = statsReadField.call(receiver, property);
                                return (value !== null) ? value : undefined;
                        }
                    },
                    set(target, property, value, receiver) {
                        return false;
                    },
                    ownKeys(target) {
                        return Array.from(statFields);
                    },
                    getOwnPropertyDescriptor(target, property) {
                        return {
                            writable: false,
                            configurable: true,
                            enumerable: true
                        };
                    },
                });
            }

            function statsHasField(name) {
                return statFields.has(name);
            }

            function statsReadField(name) {
                let field = statSpec.fields[name];
                if (field === undefined) {
                    if (name === 'birthtime') {
                        return statsReadField.call(this, 'ctime');
                    }

                    const msPos = name.lastIndexOf('Ms');
                    if (msPos === name.length - 2) {
                        return statsReadField.call(this, name.substr(0, msPos)).getTime();
                    }

                    return undefined;
                }

                const [offset, type] = field;

                const read = (typeof type === 'string') ? Memory['read' + type] : type;

                const value = read(this.buffer.add(offset));
                if (value instanceof Int64 || value instanceof UInt64)
                    return value.valueOf();

                return value;
            }

            function readTimespec32(address) {
                const sec = address.readU32();
                const nsec = address.add(4).readU32();
                const msec = nsec / 1000000;
                return new Date((sec * 1000) + msec);
            }

            function readTimespec64(address) {
                // FIXME: Improve UInt64 to support division
                const sec = address.readU64().valueOf();
                const nsec = address.add(8).readU64().valueOf();
                const msec = nsec / 1000000;
                return new Date((sec * 1000) + msec);
            }

            function getErrorString(errno) {
                return getApi().strerror(errno).readUtf8String();
            }

            function callbackify(original) {
                return function (...args) {
                    const numArgsMinusOne = args.length - 1;

                    const implArgs = args.slice(0, numArgsMinusOne);
                    const callback = args[numArgsMinusOne];

                    process.nextTick(function () {
                        try {
                            const result = original(...implArgs);
                            callback(null, result);
                        } catch (e) {
                            callback(e);
                        }
                    });
                };
            }

            const SF = SystemFunction;
            const NF = NativeFunction;

            const ssizeType = (pointerSize === 8) ? 'int64' : 'int32';
            const sizeType = 'u' + ssizeType;
            const offsetType = (platform === 'darwin' || pointerSize === 8) ? 'int64' : 'int32';

            const apiSpec = [
                ['open', SF, 'int', ['pointer', 'int', '...', 'int']],
                ['close', NF, 'int', ['int']],
                ['lseek', NF, offsetType, ['int', offsetType, 'int']],
                ['read', SF, ssizeType, ['int', 'pointer', sizeType]],
                ['opendir', SF, 'pointer', ['pointer']],
                ['opendir$INODE64', SF, 'pointer', ['pointer']],
                ['closedir', NF, 'int', ['pointer']],
                ['readdir', NF, 'pointer', ['pointer']],
                ['readdir$INODE64', NF, 'pointer', ['pointer']],
                ['readlink', SF, ssizeType, ['pointer', 'pointer', sizeType]],
                ['unlink', SF, 'int', ['pointer']],
                ['stat', SF, 'int', ['pointer', 'pointer']],
                ['stat64', SF, 'int', ['pointer', 'pointer']],
                ['lstat', SF, 'int', ['pointer', 'pointer']],
                ['lstat64', SF, 'int', ['pointer', 'pointer']],
                ['strerror', NF, 'pointer', ['int']],
            ];

            let cachedApi = null;
            function getApi() {
                if (cachedApi === null) {
                    cachedApi = apiSpec.reduce((api, entry) => {
                        addApiPlaceholder(api, entry);
                        return api;
                    }, {});
                }
                return cachedApi;
            }

            function addApiPlaceholder(api, entry) {
                const [name] = entry;

                Object.defineProperty(api, name, {
                    configurable: true,
                    get() {
                        const [, Ctor, retType, argTypes] = entry;

                        let impl = null;
                        const address = Module.findExportByName(null, name);
                        if (address !== null)
                            impl = new Ctor(address, retType, argTypes);

                        Object.defineProperty(api, name, { value: impl });

                        return impl;
                    }
                });
            }

            module.exports = {
                constants,
                createReadStream(path) {
                    return new ReadStream(path);
                },
                createWriteStream(path) {
                    return new WriteStream(path);
                },
                readdir: callbackify(readdirSync),
                readdirSync,
                list,
                readFile: callbackify(readFileSync),
                readFileSync,
                readlink: callbackify(readlinkSync),
                readlinkSync,
                unlink: callbackify(unlinkSync),
                unlinkSync,
                stat: callbackify(statSync),
                statSync,
                lstat: callbackify(lstatSync),
                lstatSync,
            };

        }).call(this)}).call(this,require('_process'),require("buffer").Buffer)

    },{"_process":14,"buffer":11,"stream":18}],14:[function(require,module,exports){
// Based on https://github.com/shtylman/node-process

        const EventEmitter = require('events');

        const process = module.exports = {};

        process.nextTick = Script.nextTick;

        process.title = 'Frida';
        process.browser = true;
        process.env = {};
        process.argv = [];
        process.version = ''; // empty string to avoid regexp issues
        process.versions = {};

        process.EventEmitter = EventEmitter;
        process.on = noop;
        process.addListener = noop;
        process.once = noop;
        process.off = noop;
        process.removeListener = noop;
        process.removeAllListeners = noop;
        process.emit = noop;

        process.binding = function (name) {
            throw new Error('process.binding is not supported');
        };

        process.cwd = function () {
            return '/'
        };
        process.chdir = function (dir) {
            throw new Error('process.chdir is not supported');
        };
        process.umask = function () {
            return 0;
        };

        function noop () {}

    },{"events":10}],15:[function(require,module,exports){
        exports.read = function (buffer, offset, isLE, mLen, nBytes) {
            var e, m
            var eLen = (nBytes * 8) - mLen - 1
            var eMax = (1 << eLen) - 1
            var eBias = eMax >> 1
            var nBits = -7
            var i = isLE ? (nBytes - 1) : 0
            var d = isLE ? -1 : 1
            var s = buffer[offset + i]

            i += d

            e = s & ((1 << (-nBits)) - 1)
            s >>= (-nBits)
            nBits += eLen
            for (; nBits > 0; e = (e * 256) + buffer[offset + i], i += d, nBits -= 8) {}

            m = e & ((1 << (-nBits)) - 1)
            e >>= (-nBits)
            nBits += mLen
            for (; nBits > 0; m = (m * 256) + buffer[offset + i], i += d, nBits -= 8) {}

            if (e === 0) {
                e = 1 - eBias
            } else if (e === eMax) {
                return m ? NaN : ((s ? -1 : 1) * Infinity)
            } else {
                m = m + Math.pow(2, mLen)
                e = e - eBias
            }
            return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
        }

        exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
            var e, m, c
            var eLen = (nBytes * 8) - mLen - 1
            var eMax = (1 << eLen) - 1
            var eBias = eMax >> 1
            var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
            var i = isLE ? 0 : (nBytes - 1)
            var d = isLE ? 1 : -1
            var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

            value = Math.abs(value)

            if (isNaN(value) || value === Infinity) {
                m = isNaN(value) ? 1 : 0
                e = eMax
            } else {
                e = Math.floor(Math.log(value) / Math.LN2)
                if (value * (c = Math.pow(2, -e)) < 1) {
                    e--
                    c *= 2
                }
                if (e + eBias >= 1) {
                    value += rt / c
                } else {
                    value += rt * Math.pow(2, 1 - eBias)
                }
                if (value * c >= 2) {
                    e++
                    c /= 2
                }

                if (e + eBias >= eMax) {
                    m = 0
                    e = eMax
                } else if (e + eBias >= 1) {
                    m = ((value * c) - 1) * Math.pow(2, mLen)
                    e = e + eBias
                } else {
                    m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
                    e = 0
                }
            }

            for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

            e = (e << mLen) | m
            eLen += mLen
            for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

            buffer[offset + i - d] |= s * 128
        }

    },{}],16:[function(require,module,exports){
        if (typeof Object.create === 'function') {
            // implementation from standard node.js 'util' module
            module.exports = function inherits(ctor, superCtor) {
                if (superCtor) {
                    ctor.super_ = superCtor
                    ctor.prototype = Object.create(superCtor.prototype, {
                        constructor: {
                            value: ctor,
                            enumerable: false,
                            writable: true,
                            configurable: true
                        }
                    })
                }
            };
        } else {
            // old school shim for old browsers
            module.exports = function inherits(ctor, superCtor) {
                if (superCtor) {
                    ctor.super_ = superCtor
                    var TempCtor = function () {}
                    TempCtor.prototype = superCtor.prototype
                    ctor.prototype = new TempCtor()
                    ctor.prototype.constructor = ctor
                }
            }
        }

    },{}],17:[function(require,module,exports){
        /* eslint-disable node/no-deprecated-api */
        var buffer = require('buffer')
        var Buffer = buffer.Buffer

// alternative to using Object.keys for old browsers
        function copyProps (src, dst) {
            for (var key in src) {
                dst[key] = src[key]
            }
        }
        if (Buffer.from && Buffer.alloc && Buffer.allocUnsafe && Buffer.allocUnsafeSlow) {
            module.exports = buffer
        } else {
            // Copy properties from require('buffer')
            copyProps(buffer, exports)
            exports.Buffer = SafeBuffer
        }

        function SafeBuffer (arg, encodingOrOffset, length) {
            return Buffer(arg, encodingOrOffset, length)
        }

// Copy static methods from Buffer
        copyProps(Buffer, SafeBuffer)

        SafeBuffer.from = function (arg, encodingOrOffset, length) {
            if (typeof arg === 'number') {
                throw new TypeError('Argument must not be a number')
            }
            return Buffer(arg, encodingOrOffset, length)
        }

        SafeBuffer.alloc = function (size, fill, encoding) {
            if (typeof size !== 'number') {
                throw new TypeError('Argument must be a number')
            }
            var buf = Buffer(size)
            if (fill !== undefined) {
                if (typeof encoding === 'string') {
                    buf.fill(fill, encoding)
                } else {
                    buf.fill(fill)
                }
            } else {
                buf.fill(0)
            }
            return buf
        }

        SafeBuffer.allocUnsafe = function (size) {
            if (typeof size !== 'number') {
                throw new TypeError('Argument must be a number')
            }
            return Buffer(size)
        }

        SafeBuffer.allocUnsafeSlow = function (size) {
            if (typeof size !== 'number') {
                throw new TypeError('Argument must be a number')
            }
            return buffer.SlowBuffer(size)
        }

    },{"buffer":11}],18:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

        module.exports = Stream;

        var EE = require('events').EventEmitter;
        var inherits = require('inherits');

        inherits(Stream, EE);
        Stream.Readable = require('readable-stream/lib/_stream_readable.js');
        Stream.Writable = require('readable-stream/lib/_stream_writable.js');
        Stream.Duplex = require('readable-stream/lib/_stream_duplex.js');
        Stream.Transform = require('readable-stream/lib/_stream_transform.js');
        Stream.PassThrough = require('readable-stream/lib/_stream_passthrough.js');
        Stream.finished = require('readable-stream/lib/internal/streams/end-of-stream.js')
        Stream.pipeline = require('readable-stream/lib/internal/streams/pipeline.js')

// Backwards-compat with node 0.4.x
        Stream.Stream = Stream;



// old-style streams.  Note that the pipe method (the only relevant
// part of this class) is overridden in the Readable class.

        function Stream() {
            EE.call(this);
        }

        Stream.prototype.pipe = function(dest, options) {
            var source = this;

            function ondata(chunk) {
                if (dest.writable) {
                    if (false === dest.write(chunk) && source.pause) {
                        source.pause();
                    }
                }
            }

            source.on('data', ondata);

            function ondrain() {
                if (source.readable && source.resume) {
                    source.resume();
                }
            }

            dest.on('drain', ondrain);

            // If the 'end' option is not supplied, dest.end() will be called when
            // source gets the 'end' or 'close' events.  Only dest.end() once.
            if (!dest._isStdio && (!options || options.end !== false)) {
                source.on('end', onend);
                source.on('close', onclose);
            }

            var didOnEnd = false;
            function onend() {
                if (didOnEnd) return;
                didOnEnd = true;

                dest.end();
            }


            function onclose() {
                if (didOnEnd) return;
                didOnEnd = true;

                if (typeof dest.destroy === 'function') dest.destroy();
            }

            // don't leave dangling pipes when there are errors.
            function onerror(er) {
                cleanup();
                if (EE.listenerCount(this, 'error') === 0) {
                    throw er; // Unhandled stream error in pipe.
                }
            }

            source.on('error', onerror);
            dest.on('error', onerror);

            // remove all the event listeners that were added.
            function cleanup() {
                source.removeListener('data', ondata);
                dest.removeListener('drain', ondrain);

                source.removeListener('end', onend);
                source.removeListener('close', onclose);

                source.removeListener('error', onerror);
                dest.removeListener('error', onerror);

                source.removeListener('end', cleanup);
                source.removeListener('close', cleanup);

                dest.removeListener('close', cleanup);
            }

            source.on('end', cleanup);
            source.on('close', cleanup);

            dest.on('close', cleanup);

            dest.emit('pipe', source);

            // Allow for unix-like usage: A.pipe(B).pipe(C)
            return dest;
        };

    },{"events":10,"inherits":16,"readable-stream/lib/_stream_duplex.js":20,"readable-stream/lib/_stream_passthrough.js":21,"readable-stream/lib/_stream_readable.js":22,"readable-stream/lib/_stream_transform.js":23,"readable-stream/lib/_stream_writable.js":24,"readable-stream/lib/internal/streams/end-of-stream.js":28,"readable-stream/lib/internal/streams/pipeline.js":30}],19:[function(require,module,exports){
        'use strict';

        function _inheritsLoose(subClass, superClass) { subClass.prototype = Object.create(superClass.prototype); subClass.prototype.constructor = subClass; subClass.__proto__ = superClass; }

        var codes = {};

        function createErrorType(code, message, Base) {
            if (!Base) {
                Base = Error;
            }

            function getMessage(arg1, arg2, arg3) {
                if (typeof message === 'string') {
                    return message;
                } else {
                    return message(arg1, arg2, arg3);
                }
            }

            var NodeError =
                /*#__PURE__*/
                function (_Base) {
                    _inheritsLoose(NodeError, _Base);

                    function NodeError(arg1, arg2, arg3) {
                        return _Base.call(this, getMessage(arg1, arg2, arg3)) || this;
                    }

                    return NodeError;
                }(Base);

            NodeError.prototype.name = Base.name;
            NodeError.prototype.code = code;
            codes[code] = NodeError;
        } // https://github.com/nodejs/node/blob/v10.8.0/lib/internal/errors.js


        function oneOf(expected, thing) {
            if (Array.isArray(expected)) {
                var len = expected.length;
                expected = expected.map(function (i) {
                    return String(i);
                });

                if (len > 2) {
                    return "one of ".concat(thing, " ").concat(expected.slice(0, len - 1).join(', '), ", or ") + expected[len - 1];
                } else if (len === 2) {
                    return "one of ".concat(thing, " ").concat(expected[0], " or ").concat(expected[1]);
                } else {
                    return "of ".concat(thing, " ").concat(expected[0]);
                }
            } else {
                return "of ".concat(thing, " ").concat(String(expected));
            }
        } // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/startsWith


        function startsWith(str, search, pos) {
            return str.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
        } // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/endsWith


        function endsWith(str, search, this_len) {
            if (this_len === undefined || this_len > str.length) {
                this_len = str.length;
            }

            return str.substring(this_len - search.length, this_len) === search;
        } // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/includes


        function includes(str, search, start) {
            if (typeof start !== 'number') {
                start = 0;
            }

            if (start + search.length > str.length) {
                return false;
            } else {
                return str.indexOf(search, start) !== -1;
            }
        }

        createErrorType('ERR_INVALID_OPT_VALUE', function (name, value) {
            return 'The value "' + value + '" is invalid for option "' + name + '"';
        }, TypeError);
        createErrorType('ERR_INVALID_ARG_TYPE', function (name, expected, actual) {
            // determiner: 'must be' or 'must not be'
            var determiner;

            if (typeof expected === 'string' && startsWith(expected, 'not ')) {
                determiner = 'must not be';
                expected = expected.replace(/^not /, '');
            } else {
                determiner = 'must be';
            }

            var msg;

            if (endsWith(name, ' argument')) {
                // For cases like 'first argument'
                msg = "The ".concat(name, " ").concat(determiner, " ").concat(oneOf(expected, 'type'));
            } else {
                var type = includes(name, '.') ? 'property' : 'argument';
                msg = "The \"".concat(name, "\" ").concat(type, " ").concat(determiner, " ").concat(oneOf(expected, 'type'));
            }

            msg += ". Received type ".concat(typeof actual);
            return msg;
        }, TypeError);
        createErrorType('ERR_STREAM_PUSH_AFTER_EOF', 'stream.push() after EOF');
        createErrorType('ERR_METHOD_NOT_IMPLEMENTED', function (name) {
            return 'The ' + name + ' method is not implemented';
        });
        createErrorType('ERR_STREAM_PREMATURE_CLOSE', 'Premature close');
        createErrorType('ERR_STREAM_DESTROYED', function (name) {
            return 'Cannot call ' + name + ' after a stream was destroyed';
        });
        createErrorType('ERR_MULTIPLE_CALLBACK', 'Callback called multiple times');
        createErrorType('ERR_STREAM_CANNOT_PIPE', 'Cannot pipe, not readable');
        createErrorType('ERR_STREAM_WRITE_AFTER_END', 'write after end');
        createErrorType('ERR_STREAM_NULL_VALUES', 'May not write null values to stream', TypeError);
        createErrorType('ERR_UNKNOWN_ENCODING', function (arg) {
            return 'Unknown encoding: ' + arg;
        }, TypeError);
        createErrorType('ERR_STREAM_UNSHIFT_AFTER_END_EVENT', 'stream.unshift() after end event');
        module.exports.codes = codes;

    },{}],20:[function(require,module,exports){
        (function (process){(function (){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.
            'use strict';
            /*<replacement>*/

            var objectKeys = Object.keys || function (obj) {
                var keys = [];

                for (var key in obj) {
                    keys.push(key);
                }

                return keys;
            };
            /*</replacement>*/


            module.exports = Duplex;

            var Readable = require('./_stream_readable');

            var Writable = require('./_stream_writable');

            require('inherits')(Duplex, Readable);

            {
                // Allow the keys array to be GC'ed.
                var keys = objectKeys(Writable.prototype);

                for (var v = 0; v < keys.length; v++) {
                    var method = keys[v];
                    if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
                }
            }

            function Duplex(options) {
                if (!(this instanceof Duplex)) return new Duplex(options);
                Readable.call(this, options);
                Writable.call(this, options);
                this.allowHalfOpen = true;

                if (options) {
                    if (options.readable === false) this.readable = false;
                    if (options.writable === false) this.writable = false;

                    if (options.allowHalfOpen === false) {
                        this.allowHalfOpen = false;
                        this.once('end', onend);
                    }
                }
            }

            Object.defineProperty(Duplex.prototype, 'writableHighWaterMark', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    return this._writableState.highWaterMark;
                }
            });
            Object.defineProperty(Duplex.prototype, 'writableBuffer', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    return this._writableState && this._writableState.getBuffer();
                }
            });
            Object.defineProperty(Duplex.prototype, 'writableLength', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    return this._writableState.length;
                }
            }); // the no-half-open enforcer

            function onend() {
                // If the writable side ended, then we're ok.
                if (this._writableState.ended) return; // no more data can be written.
                // But allow more writes to happen in this tick.

                process.nextTick(onEndNT, this);
            }

            function onEndNT(self) {
                self.end();
            }

            Object.defineProperty(Duplex.prototype, 'destroyed', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    if (this._readableState === undefined || this._writableState === undefined) {
                        return false;
                    }

                    return this._readableState.destroyed && this._writableState.destroyed;
                },
                set: function set(value) {
                    // we ignore the value if the stream
                    // has not been initialized yet
                    if (this._readableState === undefined || this._writableState === undefined) {
                        return;
                    } // backward compatibility, the user is explicitly
                    // managing destroyed


                    this._readableState.destroyed = value;
                    this._writableState.destroyed = value;
                }
            });
        }).call(this)}).call(this,require('_process'))

    },{"./_stream_readable":22,"./_stream_writable":24,"_process":14,"inherits":16}],21:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.
        'use strict';

        module.exports = PassThrough;

        var Transform = require('./_stream_transform');

        require('inherits')(PassThrough, Transform);

        function PassThrough(options) {
            if (!(this instanceof PassThrough)) return new PassThrough(options);
            Transform.call(this, options);
        }

        PassThrough.prototype._transform = function (chunk, encoding, cb) {
            cb(null, chunk);
        };
    },{"./_stream_transform":23,"inherits":16}],22:[function(require,module,exports){
        (function (process,global){(function (){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
            'use strict';

            module.exports = Readable;
            /*<replacement>*/

            var Duplex;
            /*</replacement>*/

            Readable.ReadableState = ReadableState;
            /*<replacement>*/

            var EE = require('events').EventEmitter;

            var EElistenerCount = function EElistenerCount(emitter, type) {
                return emitter.listeners(type).length;
            };
            /*</replacement>*/

            /*<replacement>*/


            var Stream = require('./internal/streams/stream');
            /*</replacement>*/


            var Buffer = require('buffer').Buffer;

            var OurUint8Array = global.Uint8Array || function () {};

            function _uint8ArrayToBuffer(chunk) {
                return Buffer.from(chunk);
            }

            function _isUint8Array(obj) {
                return Buffer.isBuffer(obj) || obj instanceof OurUint8Array;
            }
            /*<replacement>*/


            var debugUtil = require('util');

            var debug;

            if (debugUtil && debugUtil.debuglog) {
                debug = debugUtil.debuglog('stream');
            } else {
                debug = function debug() {};
            }
            /*</replacement>*/


            var BufferList = require('./internal/streams/buffer_list');

            var destroyImpl = require('./internal/streams/destroy');

            var _require = require('./internal/streams/state'),
                getHighWaterMark = _require.getHighWaterMark;

            var _require$codes = require('../errors').codes,
                ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE,
                ERR_STREAM_PUSH_AFTER_EOF = _require$codes.ERR_STREAM_PUSH_AFTER_EOF,
                ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED,
                ERR_STREAM_UNSHIFT_AFTER_END_EVENT = _require$codes.ERR_STREAM_UNSHIFT_AFTER_END_EVENT; // Lazy loaded to improve the startup performance.


            var StringDecoder;
            var createReadableStreamAsyncIterator;
            var from;

            require('inherits')(Readable, Stream);

            var errorOrDestroy = destroyImpl.errorOrDestroy;
            var kProxyEvents = ['error', 'close', 'destroy', 'pause', 'resume'];

            function prependListener(emitter, event, fn) {
                // Sadly this is not cacheable as some libraries bundle their own
                // event emitter implementation with them.
                if (typeof emitter.prependListener === 'function') return emitter.prependListener(event, fn); // This is a hack to make sure that our error handler is attached before any
                // userland ones.  NEVER DO THIS. This is here only because this code needs
                // to continue to work with older versions of Node.js that do not include
                // the prependListener() method. The goal is to eventually remove this hack.

                if (!emitter._events || !emitter._events[event]) emitter.on(event, fn);else if (Array.isArray(emitter._events[event])) emitter._events[event].unshift(fn);else emitter._events[event] = [fn, emitter._events[event]];
            }

            function ReadableState(options, stream, isDuplex) {
                Duplex = Duplex || require('./_stream_duplex');
                options = options || {}; // Duplex streams are both readable and writable, but share
                // the same options object.
                // However, some cases require setting options to different
                // values for the readable and the writable sides of the duplex stream.
                // These options can be provided separately as readableXXX and writableXXX.

                if (typeof isDuplex !== 'boolean') isDuplex = stream instanceof Duplex; // object stream flag. Used to make read(n) ignore n and to
                // make all the buffer merging and length checks go away

                this.objectMode = !!options.objectMode;
                if (isDuplex) this.objectMode = this.objectMode || !!options.readableObjectMode; // the point at which it stops calling _read() to fill the buffer
                // Note: 0 is a valid value, means "don't call _read preemptively ever"

                this.highWaterMark = getHighWaterMark(this, options, 'readableHighWaterMark', isDuplex); // A linked list is used to store data chunks instead of an array because the
                // linked list can remove elements from the beginning faster than
                // array.shift()

                this.buffer = new BufferList();
                this.length = 0;
                this.pipes = null;
                this.pipesCount = 0;
                this.flowing = null;
                this.ended = false;
                this.endEmitted = false;
                this.reading = false; // a flag to be able to tell if the event 'readable'/'data' is emitted
                // immediately, or on a later tick.  We set this to true at first, because
                // any actions that shouldn't happen until "later" should generally also
                // not happen before the first read call.

                this.sync = true; // whenever we return null, then we set a flag to say
                // that we're awaiting a 'readable' event emission.

                this.needReadable = false;
                this.emittedReadable = false;
                this.readableListening = false;
                this.resumeScheduled = false;
                this.paused = true; // Should close be emitted on destroy. Defaults to true.

                this.emitClose = options.emitClose !== false; // Should .destroy() be called after 'end' (and potentially 'finish')

                this.autoDestroy = !!options.autoDestroy; // has it been destroyed

                this.destroyed = false; // Crypto is kind of old and crusty.  Historically, its default string
                // encoding is 'binary' so we have to make this configurable.
                // Everything else in the universe uses 'utf8', though.

                this.defaultEncoding = options.defaultEncoding || 'utf8'; // the number of writers that are awaiting a drain event in .pipe()s

                this.awaitDrain = 0; // if true, a maybeReadMore has been scheduled

                this.readingMore = false;
                this.decoder = null;
                this.encoding = null;

                if (options.encoding) {
                    if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
                    this.decoder = new StringDecoder(options.encoding);
                    this.encoding = options.encoding;
                }
            }

            function Readable(options) {
                Duplex = Duplex || require('./_stream_duplex');
                if (!(this instanceof Readable)) return new Readable(options); // Checking for a Stream.Duplex instance is faster here instead of inside
                // the ReadableState constructor, at least with V8 6.5

                var isDuplex = this instanceof Duplex;
                this._readableState = new ReadableState(options, this, isDuplex); // legacy

                this.readable = true;

                if (options) {
                    if (typeof options.read === 'function') this._read = options.read;
                    if (typeof options.destroy === 'function') this._destroy = options.destroy;
                }

                Stream.call(this);
            }

            Object.defineProperty(Readable.prototype, 'destroyed', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    if (this._readableState === undefined) {
                        return false;
                    }

                    return this._readableState.destroyed;
                },
                set: function set(value) {
                    // we ignore the value if the stream
                    // has not been initialized yet
                    if (!this._readableState) {
                        return;
                    } // backward compatibility, the user is explicitly
                    // managing destroyed


                    this._readableState.destroyed = value;
                }
            });
            Readable.prototype.destroy = destroyImpl.destroy;
            Readable.prototype._undestroy = destroyImpl.undestroy;

            Readable.prototype._destroy = function (err, cb) {
                cb(err);
            }; // Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.


            Readable.prototype.push = function (chunk, encoding) {
                var state = this._readableState;
                var skipChunkCheck;

                if (!state.objectMode) {
                    if (typeof chunk === 'string') {
                        encoding = encoding || state.defaultEncoding;

                        if (encoding !== state.encoding) {
                            chunk = Buffer.from(chunk, encoding);
                            encoding = '';
                        }

                        skipChunkCheck = true;
                    }
                } else {
                    skipChunkCheck = true;
                }

                return readableAddChunk(this, chunk, encoding, false, skipChunkCheck);
            }; // Unshift should *always* be something directly out of read()


            Readable.prototype.unshift = function (chunk) {
                return readableAddChunk(this, chunk, null, true, false);
            };

            function readableAddChunk(stream, chunk, encoding, addToFront, skipChunkCheck) {
                debug('readableAddChunk', chunk);
                var state = stream._readableState;

                if (chunk === null) {
                    state.reading = false;
                    onEofChunk(stream, state);
                } else {
                    var er;
                    if (!skipChunkCheck) er = chunkInvalid(state, chunk);

                    if (er) {
                        errorOrDestroy(stream, er);
                    } else if (state.objectMode || chunk && chunk.length > 0) {
                        if (typeof chunk !== 'string' && !state.objectMode && Object.getPrototypeOf(chunk) !== Buffer.prototype) {
                            chunk = _uint8ArrayToBuffer(chunk);
                        }

                        if (addToFront) {
                            if (state.endEmitted) errorOrDestroy(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT());else addChunk(stream, state, chunk, true);
                        } else if (state.ended) {
                            errorOrDestroy(stream, new ERR_STREAM_PUSH_AFTER_EOF());
                        } else if (state.destroyed) {
                            return false;
                        } else {
                            state.reading = false;

                            if (state.decoder && !encoding) {
                                chunk = state.decoder.write(chunk);
                                if (state.objectMode || chunk.length !== 0) addChunk(stream, state, chunk, false);else maybeReadMore(stream, state);
                            } else {
                                addChunk(stream, state, chunk, false);
                            }
                        }
                    } else if (!addToFront) {
                        state.reading = false;
                        maybeReadMore(stream, state);
                    }
                } // We can push more data if we are below the highWaterMark.
                // Also, if we have no data yet, we can stand some more bytes.
                // This is to work around cases where hwm=0, such as the repl.


                return !state.ended && (state.length < state.highWaterMark || state.length === 0);
            }

            function addChunk(stream, state, chunk, addToFront) {
                if (state.flowing && state.length === 0 && !state.sync) {
                    state.awaitDrain = 0;
                    stream.emit('data', chunk);
                } else {
                    // update the buffer info.
                    state.length += state.objectMode ? 1 : chunk.length;
                    if (addToFront) state.buffer.unshift(chunk);else state.buffer.push(chunk);
                    if (state.needReadable) emitReadable(stream);
                }

                maybeReadMore(stream, state);
            }

            function chunkInvalid(state, chunk) {
                var er;

                if (!_isUint8Array(chunk) && typeof chunk !== 'string' && chunk !== undefined && !state.objectMode) {
                    er = new ERR_INVALID_ARG_TYPE('chunk', ['string', 'Buffer', 'Uint8Array'], chunk);
                }

                return er;
            }

            Readable.prototype.isPaused = function () {
                return this._readableState.flowing === false;
            }; // backwards compatibility.


            Readable.prototype.setEncoding = function (enc) {
                if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
                var decoder = new StringDecoder(enc);
                this._readableState.decoder = decoder; // If setEncoding(null), decoder.encoding equals utf8

                this._readableState.encoding = this._readableState.decoder.encoding; // Iterate over current buffer to convert already stored Buffers:

                var p = this._readableState.buffer.head;
                var content = '';

                while (p !== null) {
                    content += decoder.write(p.data);
                    p = p.next;
                }

                this._readableState.buffer.clear();

                if (content !== '') this._readableState.buffer.push(content);
                this._readableState.length = content.length;
                return this;
            }; // Don't raise the hwm > 1GB


            var MAX_HWM = 0x40000000;

            function computeNewHighWaterMark(n) {
                if (n >= MAX_HWM) {
                    // TODO(ronag): Throw ERR_VALUE_OUT_OF_RANGE.
                    n = MAX_HWM;
                } else {
                    // Get the next highest power of 2 to prevent increasing hwm excessively in
                    // tiny amounts
                    n--;
                    n |= n >>> 1;
                    n |= n >>> 2;
                    n |= n >>> 4;
                    n |= n >>> 8;
                    n |= n >>> 16;
                    n++;
                }

                return n;
            } // This function is designed to be inlinable, so please take care when making
// changes to the function body.


            function howMuchToRead(n, state) {
                if (n <= 0 || state.length === 0 && state.ended) return 0;
                if (state.objectMode) return 1;

                if (n !== n) {
                    // Only flow one buffer at a time
                    if (state.flowing && state.length) return state.buffer.head.data.length;else return state.length;
                } // If we're asking for more than the current hwm, then raise the hwm.


                if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);
                if (n <= state.length) return n; // Don't have enough

                if (!state.ended) {
                    state.needReadable = true;
                    return 0;
                }

                return state.length;
            } // you can override either this method, or the async _read(n) below.


            Readable.prototype.read = function (n) {
                debug('read', n);
                n = parseInt(n, 10);
                var state = this._readableState;
                var nOrig = n;
                if (n !== 0) state.emittedReadable = false; // if we're doing read(0) to trigger a readable event, but we
                // already have a bunch of data in the buffer, then just trigger
                // the 'readable' event and move on.

                if (n === 0 && state.needReadable && ((state.highWaterMark !== 0 ? state.length >= state.highWaterMark : state.length > 0) || state.ended)) {
                    debug('read: emitReadable', state.length, state.ended);
                    if (state.length === 0 && state.ended) endReadable(this);else emitReadable(this);
                    return null;
                }

                n = howMuchToRead(n, state); // if we've ended, and we're now clear, then finish it up.

                if (n === 0 && state.ended) {
                    if (state.length === 0) endReadable(this);
                    return null;
                } // All the actual chunk generation logic needs to be
                // *below* the call to _read.  The reason is that in certain
                // synthetic stream cases, such as passthrough streams, _read
                // may be a completely synchronous operation which may change
                // the state of the read buffer, providing enough data when
                // before there was *not* enough.
                //
                // So, the steps are:
                // 1. Figure out what the state of things will be after we do
                // a read from the buffer.
                //
                // 2. If that resulting state will trigger a _read, then call _read.
                // Note that this may be asynchronous, or synchronous.  Yes, it is
                // deeply ugly to write APIs this way, but that still doesn't mean
                // that the Readable class should behave improperly, as streams are
                // designed to be sync/async agnostic.
                // Take note if the _read call is sync or async (ie, if the read call
                // has returned yet), so that we know whether or not it's safe to emit
                // 'readable' etc.
                //
                // 3. Actually pull the requested chunks out of the buffer and return.
                // if we need a readable event, then we need to do some reading.


                var doRead = state.needReadable;
                debug('need readable', doRead); // if we currently have less than the highWaterMark, then also read some

                if (state.length === 0 || state.length - n < state.highWaterMark) {
                    doRead = true;
                    debug('length less than watermark', doRead);
                } // however, if we've ended, then there's no point, and if we're already
                // reading, then it's unnecessary.


                if (state.ended || state.reading) {
                    doRead = false;
                    debug('reading or ended', doRead);
                } else if (doRead) {
                    debug('do read');
                    state.reading = true;
                    state.sync = true; // if the length is currently zero, then we *need* a readable event.

                    if (state.length === 0) state.needReadable = true; // call internal read method

                    this._read(state.highWaterMark);

                    state.sync = false; // If _read pushed data synchronously, then `reading` will be false,
                    // and we need to re-evaluate how much data we can return to the user.

                    if (!state.reading) n = howMuchToRead(nOrig, state);
                }

                var ret;
                if (n > 0) ret = fromList(n, state);else ret = null;

                if (ret === null) {
                    state.needReadable = state.length <= state.highWaterMark;
                    n = 0;
                } else {
                    state.length -= n;
                    state.awaitDrain = 0;
                }

                if (state.length === 0) {
                    // If we have nothing in the buffer, then we want to know
                    // as soon as we *do* get something into the buffer.
                    if (!state.ended) state.needReadable = true; // If we tried to read() past the EOF, then emit end on the next tick.

                    if (nOrig !== n && state.ended) endReadable(this);
                }

                if (ret !== null) this.emit('data', ret);
                return ret;
            };

            function onEofChunk(stream, state) {
                debug('onEofChunk');
                if (state.ended) return;

                if (state.decoder) {
                    var chunk = state.decoder.end();

                    if (chunk && chunk.length) {
                        state.buffer.push(chunk);
                        state.length += state.objectMode ? 1 : chunk.length;
                    }
                }

                state.ended = true;

                if (state.sync) {
                    // if we are sync, wait until next tick to emit the data.
                    // Otherwise we risk emitting data in the flow()
                    // the readable code triggers during a read() call
                    emitReadable(stream);
                } else {
                    // emit 'readable' now to make sure it gets picked up.
                    state.needReadable = false;

                    if (!state.emittedReadable) {
                        state.emittedReadable = true;
                        emitReadable_(stream);
                    }
                }
            } // Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.


            function emitReadable(stream) {
                var state = stream._readableState;
                debug('emitReadable', state.needReadable, state.emittedReadable);
                state.needReadable = false;

                if (!state.emittedReadable) {
                    debug('emitReadable', state.flowing);
                    state.emittedReadable = true;
                    process.nextTick(emitReadable_, stream);
                }
            }

            function emitReadable_(stream) {
                var state = stream._readableState;
                debug('emitReadable_', state.destroyed, state.length, state.ended);

                if (!state.destroyed && (state.length || state.ended)) {
                    stream.emit('readable');
                    state.emittedReadable = false;
                } // The stream needs another readable event if
                // 1. It is not flowing, as the flow mechanism will take
                //    care of it.
                // 2. It is not ended.
                // 3. It is below the highWaterMark, so we can schedule
                //    another readable later.


                state.needReadable = !state.flowing && !state.ended && state.length <= state.highWaterMark;
                flow(stream);
            } // at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.


            function maybeReadMore(stream, state) {
                if (!state.readingMore) {
                    state.readingMore = true;
                    process.nextTick(maybeReadMore_, stream, state);
                }
            }

            function maybeReadMore_(stream, state) {
                // Attempt to read more data if we should.
                //
                // The conditions for reading more data are (one of):
                // - Not enough data buffered (state.length < state.highWaterMark). The loop
                //   is responsible for filling the buffer with enough data if such data
                //   is available. If highWaterMark is 0 and we are not in the flowing mode
                //   we should _not_ attempt to buffer any extra data. We'll get more data
                //   when the stream consumer calls read() instead.
                // - No data in the buffer, and the stream is in flowing mode. In this mode
                //   the loop below is responsible for ensuring read() is called. Failing to
                //   call read here would abort the flow and there's no other mechanism for
                //   continuing the flow if the stream consumer has just subscribed to the
                //   'data' event.
                //
                // In addition to the above conditions to keep reading data, the following
                // conditions prevent the data from being read:
                // - The stream has ended (state.ended).
                // - There is already a pending 'read' operation (state.reading). This is a
                //   case where the the stream has called the implementation defined _read()
                //   method, but they are processing the call asynchronously and have _not_
                //   called push() with new data. In this case we skip performing more
                //   read()s. The execution ends in this method again after the _read() ends
                //   up calling push() with more data.
                while (!state.reading && !state.ended && (state.length < state.highWaterMark || state.flowing && state.length === 0)) {
                    var len = state.length;
                    debug('maybeReadMore read 0');
                    stream.read(0);
                    if (len === state.length) // didn't get any data, stop spinning.
                        break;
                }

                state.readingMore = false;
            } // abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.


            Readable.prototype._read = function (n) {
                errorOrDestroy(this, new ERR_METHOD_NOT_IMPLEMENTED('_read()'));
            };

            Readable.prototype.pipe = function (dest, pipeOpts) {
                var src = this;
                var state = this._readableState;

                switch (state.pipesCount) {
                    case 0:
                        state.pipes = dest;
                        break;

                    case 1:
                        state.pipes = [state.pipes, dest];
                        break;

                    default:
                        state.pipes.push(dest);
                        break;
                }

                state.pipesCount += 1;
                debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);
                var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;
                var endFn = doEnd ? onend : unpipe;
                if (state.endEmitted) process.nextTick(endFn);else src.once('end', endFn);
                dest.on('unpipe', onunpipe);

                function onunpipe(readable, unpipeInfo) {
                    debug('onunpipe');

                    if (readable === src) {
                        if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
                            unpipeInfo.hasUnpiped = true;
                            cleanup();
                        }
                    }
                }

                function onend() {
                    debug('onend');
                    dest.end();
                } // when the dest drains, it reduces the awaitDrain counter
                // on the source.  This would be more elegant with a .once()
                // handler in flow(), but adding and removing repeatedly is
                // too slow.


                var ondrain = pipeOnDrain(src);
                dest.on('drain', ondrain);
                var cleanedUp = false;

                function cleanup() {
                    debug('cleanup'); // cleanup event handlers once the pipe is broken

                    dest.removeListener('close', onclose);
                    dest.removeListener('finish', onfinish);
                    dest.removeListener('drain', ondrain);
                    dest.removeListener('error', onerror);
                    dest.removeListener('unpipe', onunpipe);
                    src.removeListener('end', onend);
                    src.removeListener('end', unpipe);
                    src.removeListener('data', ondata);
                    cleanedUp = true; // if the reader is waiting for a drain event from this
                    // specific writer, then it would cause it to never start
                    // flowing again.
                    // So, if this is awaiting a drain, then we just call it now.
                    // If we don't know, then assume that we are waiting for one.

                    if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
                }

                src.on('data', ondata);

                function ondata(chunk) {
                    debug('ondata');
                    var ret = dest.write(chunk);
                    debug('dest.write', ret);

                    if (ret === false) {
                        // If the user unpiped during `dest.write()`, it is possible
                        // to get stuck in a permanently paused state if that write
                        // also returned false.
                        // => Check whether `dest` is still a piping destination.
                        if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1) && !cleanedUp) {
                            debug('false write response, pause', state.awaitDrain);
                            state.awaitDrain++;
                        }

                        src.pause();
                    }
                } // if the dest has an error, then stop piping into it.
                // however, don't suppress the throwing behavior for this.


                function onerror(er) {
                    debug('onerror', er);
                    unpipe();
                    dest.removeListener('error', onerror);
                    if (EElistenerCount(dest, 'error') === 0) errorOrDestroy(dest, er);
                } // Make sure our error handler is attached before userland ones.


                prependListener(dest, 'error', onerror); // Both close and finish should trigger unpipe, but only once.

                function onclose() {
                    dest.removeListener('finish', onfinish);
                    unpipe();
                }

                dest.once('close', onclose);

                function onfinish() {
                    debug('onfinish');
                    dest.removeListener('close', onclose);
                    unpipe();
                }

                dest.once('finish', onfinish);

                function unpipe() {
                    debug('unpipe');
                    src.unpipe(dest);
                } // tell the dest that it's being piped to


                dest.emit('pipe', src); // start the flow if it hasn't been started already.

                if (!state.flowing) {
                    debug('pipe resume');
                    src.resume();
                }

                return dest;
            };

            function pipeOnDrain(src) {
                return function pipeOnDrainFunctionResult() {
                    var state = src._readableState;
                    debug('pipeOnDrain', state.awaitDrain);
                    if (state.awaitDrain) state.awaitDrain--;

                    if (state.awaitDrain === 0 && EElistenerCount(src, 'data')) {
                        state.flowing = true;
                        flow(src);
                    }
                };
            }

            Readable.prototype.unpipe = function (dest) {
                var state = this._readableState;
                var unpipeInfo = {
                    hasUnpiped: false
                }; // if we're not piping anywhere, then do nothing.

                if (state.pipesCount === 0) return this; // just one destination.  most common case.

                if (state.pipesCount === 1) {
                    // passed in one, but it's not the right one.
                    if (dest && dest !== state.pipes) return this;
                    if (!dest) dest = state.pipes; // got a match.

                    state.pipes = null;
                    state.pipesCount = 0;
                    state.flowing = false;
                    if (dest) dest.emit('unpipe', this, unpipeInfo);
                    return this;
                } // slow case. multiple pipe destinations.


                if (!dest) {
                    // remove all.
                    var dests = state.pipes;
                    var len = state.pipesCount;
                    state.pipes = null;
                    state.pipesCount = 0;
                    state.flowing = false;

                    for (var i = 0; i < len; i++) {
                        dests[i].emit('unpipe', this, {
                            hasUnpiped: false
                        });
                    }

                    return this;
                } // try to find the right one.


                var index = indexOf(state.pipes, dest);
                if (index === -1) return this;
                state.pipes.splice(index, 1);
                state.pipesCount -= 1;
                if (state.pipesCount === 1) state.pipes = state.pipes[0];
                dest.emit('unpipe', this, unpipeInfo);
                return this;
            }; // set up data events if they are asked for
// Ensure readable listeners eventually get something


            Readable.prototype.on = function (ev, fn) {
                var res = Stream.prototype.on.call(this, ev, fn);
                var state = this._readableState;

                if (ev === 'data') {
                    // update readableListening so that resume() may be a no-op
                    // a few lines down. This is needed to support once('readable').
                    state.readableListening = this.listenerCount('readable') > 0; // Try start flowing on next tick if stream isn't explicitly paused

                    if (state.flowing !== false) this.resume();
                } else if (ev === 'readable') {
                    if (!state.endEmitted && !state.readableListening) {
                        state.readableListening = state.needReadable = true;
                        state.flowing = false;
                        state.emittedReadable = false;
                        debug('on readable', state.length, state.reading);

                        if (state.length) {
                            emitReadable(this);
                        } else if (!state.reading) {
                            process.nextTick(nReadingNextTick, this);
                        }
                    }
                }

                return res;
            };

            Readable.prototype.addListener = Readable.prototype.on;

            Readable.prototype.removeListener = function (ev, fn) {
                var res = Stream.prototype.removeListener.call(this, ev, fn);

                if (ev === 'readable') {
                    // We need to check if there is someone still listening to
                    // readable and reset the state. However this needs to happen
                    // after readable has been emitted but before I/O (nextTick) to
                    // support once('readable', fn) cycles. This means that calling
                    // resume within the same tick will have no
                    // effect.
                    process.nextTick(updateReadableListening, this);
                }

                return res;
            };

            Readable.prototype.removeAllListeners = function (ev) {
                var res = Stream.prototype.removeAllListeners.apply(this, arguments);

                if (ev === 'readable' || ev === undefined) {
                    // We need to check if there is someone still listening to
                    // readable and reset the state. However this needs to happen
                    // after readable has been emitted but before I/O (nextTick) to
                    // support once('readable', fn) cycles. This means that calling
                    // resume within the same tick will have no
                    // effect.
                    process.nextTick(updateReadableListening, this);
                }

                return res;
            };

            function updateReadableListening(self) {
                var state = self._readableState;
                state.readableListening = self.listenerCount('readable') > 0;

                if (state.resumeScheduled && !state.paused) {
                    // flowing needs to be set to true now, otherwise
                    // the upcoming resume will not flow.
                    state.flowing = true; // crude way to check if we should resume
                } else if (self.listenerCount('data') > 0) {
                    self.resume();
                }
            }

            function nReadingNextTick(self) {
                debug('readable nexttick read 0');
                self.read(0);
            } // pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.


            Readable.prototype.resume = function () {
                var state = this._readableState;

                if (!state.flowing) {
                    debug('resume'); // we flow only if there is no one listening
                    // for readable, but we still have to call
                    // resume()

                    state.flowing = !state.readableListening;
                    resume(this, state);
                }

                state.paused = false;
                return this;
            };

            function resume(stream, state) {
                if (!state.resumeScheduled) {
                    state.resumeScheduled = true;
                    process.nextTick(resume_, stream, state);
                }
            }

            function resume_(stream, state) {
                debug('resume', state.reading);

                if (!state.reading) {
                    stream.read(0);
                }

                state.resumeScheduled = false;
                stream.emit('resume');
                flow(stream);
                if (state.flowing && !state.reading) stream.read(0);
            }

            Readable.prototype.pause = function () {
                debug('call pause flowing=%j', this._readableState.flowing);

                if (this._readableState.flowing !== false) {
                    debug('pause');
                    this._readableState.flowing = false;
                    this.emit('pause');
                }

                this._readableState.paused = true;
                return this;
            };

            function flow(stream) {
                var state = stream._readableState;
                debug('flow', state.flowing);

                while (state.flowing && stream.read() !== null) {
                    ;
                }
            } // wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.


            Readable.prototype.wrap = function (stream) {
                var _this = this;

                var state = this._readableState;
                var paused = false;
                stream.on('end', function () {
                    debug('wrapped end');

                    if (state.decoder && !state.ended) {
                        var chunk = state.decoder.end();
                        if (chunk && chunk.length) _this.push(chunk);
                    }

                    _this.push(null);
                });
                stream.on('data', function (chunk) {
                    debug('wrapped data');
                    if (state.decoder) chunk = state.decoder.write(chunk); // don't skip over falsy values in objectMode

                    if (state.objectMode && (chunk === null || chunk === undefined)) return;else if (!state.objectMode && (!chunk || !chunk.length)) return;

                    var ret = _this.push(chunk);

                    if (!ret) {
                        paused = true;
                        stream.pause();
                    }
                }); // proxy all the other methods.
                // important when wrapping filters and duplexes.

                for (var i in stream) {
                    if (this[i] === undefined && typeof stream[i] === 'function') {
                        this[i] = function methodWrap(method) {
                            return function methodWrapReturnFunction() {
                                return stream[method].apply(stream, arguments);
                            };
                        }(i);
                    }
                } // proxy certain important events.


                for (var n = 0; n < kProxyEvents.length; n++) {
                    stream.on(kProxyEvents[n], this.emit.bind(this, kProxyEvents[n]));
                } // when we try to consume some more bytes, simply unpause the
                // underlying stream.


                this._read = function (n) {
                    debug('wrapped _read', n);

                    if (paused) {
                        paused = false;
                        stream.resume();
                    }
                };

                return this;
            };

            if (typeof Symbol === 'function') {
                Readable.prototype[Symbol.asyncIterator] = function () {
                    if (createReadableStreamAsyncIterator === undefined) {
                        createReadableStreamAsyncIterator = require('./internal/streams/async_iterator');
                    }

                    return createReadableStreamAsyncIterator(this);
                };
            }

            Object.defineProperty(Readable.prototype, 'readableHighWaterMark', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    return this._readableState.highWaterMark;
                }
            });
            Object.defineProperty(Readable.prototype, 'readableBuffer', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    return this._readableState && this._readableState.buffer;
                }
            });
            Object.defineProperty(Readable.prototype, 'readableFlowing', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    return this._readableState.flowing;
                },
                set: function set(state) {
                    if (this._readableState) {
                        this._readableState.flowing = state;
                    }
                }
            }); // exposed for testing purposes only.

            Readable._fromList = fromList;
            Object.defineProperty(Readable.prototype, 'readableLength', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    return this._readableState.length;
                }
            }); // Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.

            function fromList(n, state) {
                // nothing buffered
                if (state.length === 0) return null;
                var ret;
                if (state.objectMode) ret = state.buffer.shift();else if (!n || n >= state.length) {
                    // read it all, truncate the list
                    if (state.decoder) ret = state.buffer.join('');else if (state.buffer.length === 1) ret = state.buffer.first();else ret = state.buffer.concat(state.length);
                    state.buffer.clear();
                } else {
                    // read part of list
                    ret = state.buffer.consume(n, state.decoder);
                }
                return ret;
            }

            function endReadable(stream) {
                var state = stream._readableState;
                debug('endReadable', state.endEmitted);

                if (!state.endEmitted) {
                    state.ended = true;
                    process.nextTick(endReadableNT, state, stream);
                }
            }

            function endReadableNT(state, stream) {
                debug('endReadableNT', state.endEmitted, state.length); // Check that we didn't get one last unshift.

                if (!state.endEmitted && state.length === 0) {
                    state.endEmitted = true;
                    stream.readable = false;
                    stream.emit('end');

                    if (state.autoDestroy) {
                        // In case of duplex streams we need a way to detect
                        // if the writable side is ready for autoDestroy as well
                        var wState = stream._writableState;

                        if (!wState || wState.autoDestroy && wState.finished) {
                            stream.destroy();
                        }
                    }
                }
            }

            if (typeof Symbol === 'function') {
                Readable.from = function (iterable, opts) {
                    if (from === undefined) {
                        from = require('./internal/streams/from');
                    }

                    return from(Readable, iterable, opts);
                };
            }

            function indexOf(xs, x) {
                for (var i = 0, l = xs.length; i < l; i++) {
                    if (xs[i] === x) return i;
                }

                return -1;
            }
        }).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

    },{"../errors":19,"./_stream_duplex":20,"./internal/streams/async_iterator":25,"./internal/streams/buffer_list":26,"./internal/streams/destroy":27,"./internal/streams/from":29,"./internal/streams/state":31,"./internal/streams/stream":32,"_process":14,"buffer":11,"events":10,"inherits":16,"string_decoder/":33,"util":9}],23:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.
        'use strict';

        module.exports = Transform;

        var _require$codes = require('../errors').codes,
            ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED,
            ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK,
            ERR_TRANSFORM_ALREADY_TRANSFORMING = _require$codes.ERR_TRANSFORM_ALREADY_TRANSFORMING,
            ERR_TRANSFORM_WITH_LENGTH_0 = _require$codes.ERR_TRANSFORM_WITH_LENGTH_0;

        var Duplex = require('./_stream_duplex');

        require('inherits')(Transform, Duplex);

        function afterTransform(er, data) {
            var ts = this._transformState;
            ts.transforming = false;
            var cb = ts.writecb;

            if (cb === null) {
                return this.emit('error', new ERR_MULTIPLE_CALLBACK());
            }

            ts.writechunk = null;
            ts.writecb = null;
            if (data != null) // single equals check for both `null` and `undefined`
                this.push(data);
            cb(er);
            var rs = this._readableState;
            rs.reading = false;

            if (rs.needReadable || rs.length < rs.highWaterMark) {
                this._read(rs.highWaterMark);
            }
        }

        function Transform(options) {
            if (!(this instanceof Transform)) return new Transform(options);
            Duplex.call(this, options);
            this._transformState = {
                afterTransform: afterTransform.bind(this),
                needTransform: false,
                transforming: false,
                writecb: null,
                writechunk: null,
                writeencoding: null
            }; // start out asking for a readable event once data is transformed.

            this._readableState.needReadable = true; // we have implemented the _read method, and done the other things
            // that Readable wants before the first _read call, so unset the
            // sync guard flag.

            this._readableState.sync = false;

            if (options) {
                if (typeof options.transform === 'function') this._transform = options.transform;
                if (typeof options.flush === 'function') this._flush = options.flush;
            } // When the writable side finishes, then flush out anything remaining.


            this.on('prefinish', prefinish);
        }

        function prefinish() {
            var _this = this;

            if (typeof this._flush === 'function' && !this._readableState.destroyed) {
                this._flush(function (er, data) {
                    done(_this, er, data);
                });
            } else {
                done(this, null, null);
            }
        }

        Transform.prototype.push = function (chunk, encoding) {
            this._transformState.needTransform = false;
            return Duplex.prototype.push.call(this, chunk, encoding);
        }; // This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.


        Transform.prototype._transform = function (chunk, encoding, cb) {
            cb(new ERR_METHOD_NOT_IMPLEMENTED('_transform()'));
        };

        Transform.prototype._write = function (chunk, encoding, cb) {
            var ts = this._transformState;
            ts.writecb = cb;
            ts.writechunk = chunk;
            ts.writeencoding = encoding;

            if (!ts.transforming) {
                var rs = this._readableState;
                if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
            }
        }; // Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.


        Transform.prototype._read = function (n) {
            var ts = this._transformState;

            if (ts.writechunk !== null && !ts.transforming) {
                ts.transforming = true;

                this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
            } else {
                // mark that we need a transform, so that any data that comes in
                // will get processed, now that we've asked for it.
                ts.needTransform = true;
            }
        };

        Transform.prototype._destroy = function (err, cb) {
            Duplex.prototype._destroy.call(this, err, function (err2) {
                cb(err2);
            });
        };

        function done(stream, er, data) {
            if (er) return stream.emit('error', er);
            if (data != null) // single equals check for both `null` and `undefined`
                stream.push(data); // TODO(BridgeAR): Write a test for these two error cases
            // if there's nothing in the write buffer, then that means
            // that nothing more will ever be provided

            if (stream._writableState.length) throw new ERR_TRANSFORM_WITH_LENGTH_0();
            if (stream._transformState.transforming) throw new ERR_TRANSFORM_ALREADY_TRANSFORMING();
            return stream.push(null);
        }
    },{"../errors":19,"./_stream_duplex":20,"inherits":16}],24:[function(require,module,exports){
        (function (process,global){(function (){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
// A bit simpler than readable streams.
// Implement an async ._write(chunk, encoding, cb), and it'll handle all
// the drain event emission and buffering.
            'use strict';

            module.exports = Writable;
            /* <replacement> */

            function WriteReq(chunk, encoding, cb) {
                this.chunk = chunk;
                this.encoding = encoding;
                this.callback = cb;
                this.next = null;
            } // It seems a linked list but it is not
// there will be only 2 of these for each stream


            function CorkedRequest(state) {
                var _this = this;

                this.next = null;
                this.entry = null;

                this.finish = function () {
                    onCorkedFinish(_this, state);
                };
            }
            /* </replacement> */

            /*<replacement>*/


            var Duplex;
            /*</replacement>*/

            Writable.WritableState = WritableState;
            /*<replacement>*/

            var internalUtil = {
                deprecate: require('util-deprecate')
            };
            /*</replacement>*/

            /*<replacement>*/

            var Stream = require('./internal/streams/stream');
            /*</replacement>*/


            var Buffer = require('buffer').Buffer;

            var OurUint8Array = global.Uint8Array || function () {};

            function _uint8ArrayToBuffer(chunk) {
                return Buffer.from(chunk);
            }

            function _isUint8Array(obj) {
                return Buffer.isBuffer(obj) || obj instanceof OurUint8Array;
            }

            var destroyImpl = require('./internal/streams/destroy');

            var _require = require('./internal/streams/state'),
                getHighWaterMark = _require.getHighWaterMark;

            var _require$codes = require('../errors').codes,
                ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE,
                ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED,
                ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK,
                ERR_STREAM_CANNOT_PIPE = _require$codes.ERR_STREAM_CANNOT_PIPE,
                ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED,
                ERR_STREAM_NULL_VALUES = _require$codes.ERR_STREAM_NULL_VALUES,
                ERR_STREAM_WRITE_AFTER_END = _require$codes.ERR_STREAM_WRITE_AFTER_END,
                ERR_UNKNOWN_ENCODING = _require$codes.ERR_UNKNOWN_ENCODING;

            var errorOrDestroy = destroyImpl.errorOrDestroy;

            require('inherits')(Writable, Stream);

            function nop() {}

            function WritableState(options, stream, isDuplex) {
                Duplex = Duplex || require('./_stream_duplex');
                options = options || {}; // Duplex streams are both readable and writable, but share
                // the same options object.
                // However, some cases require setting options to different
                // values for the readable and the writable sides of the duplex stream,
                // e.g. options.readableObjectMode vs. options.writableObjectMode, etc.

                if (typeof isDuplex !== 'boolean') isDuplex = stream instanceof Duplex; // object stream flag to indicate whether or not this stream
                // contains buffers or objects.

                this.objectMode = !!options.objectMode;
                if (isDuplex) this.objectMode = this.objectMode || !!options.writableObjectMode; // the point at which write() starts returning false
                // Note: 0 is a valid value, means that we always return false if
                // the entire buffer is not flushed immediately on write()

                this.highWaterMark = getHighWaterMark(this, options, 'writableHighWaterMark', isDuplex); // if _final has been called

                this.finalCalled = false; // drain event flag.

                this.needDrain = false; // at the start of calling end()

                this.ending = false; // when end() has been called, and returned

                this.ended = false; // when 'finish' is emitted

                this.finished = false; // has it been destroyed

                this.destroyed = false; // should we decode strings into buffers before passing to _write?
                // this is here so that some node-core streams can optimize string
                // handling at a lower level.

                var noDecode = options.decodeStrings === false;
                this.decodeStrings = !noDecode; // Crypto is kind of old and crusty.  Historically, its default string
                // encoding is 'binary' so we have to make this configurable.
                // Everything else in the universe uses 'utf8', though.

                this.defaultEncoding = options.defaultEncoding || 'utf8'; // not an actual buffer we keep track of, but a measurement
                // of how much we're waiting to get pushed to some underlying
                // socket or file.

                this.length = 0; // a flag to see when we're in the middle of a write.

                this.writing = false; // when true all writes will be buffered until .uncork() call

                this.corked = 0; // a flag to be able to tell if the onwrite cb is called immediately,
                // or on a later tick.  We set this to true at first, because any
                // actions that shouldn't happen until "later" should generally also
                // not happen before the first write call.

                this.sync = true; // a flag to know if we're processing previously buffered items, which
                // may call the _write() callback in the same tick, so that we don't
                // end up in an overlapped onwrite situation.

                this.bufferProcessing = false; // the callback that's passed to _write(chunk,cb)

                this.onwrite = function (er) {
                    onwrite(stream, er);
                }; // the callback that the user supplies to write(chunk,encoding,cb)


                this.writecb = null; // the amount that is being written when _write is called.

                this.writelen = 0;
                this.bufferedRequest = null;
                this.lastBufferedRequest = null; // number of pending user-supplied write callbacks
                // this must be 0 before 'finish' can be emitted

                this.pendingcb = 0; // emit prefinish if the only thing we're waiting for is _write cbs
                // This is relevant for synchronous Transform streams

                this.prefinished = false; // True if the error was already emitted and should not be thrown again

                this.errorEmitted = false; // Should close be emitted on destroy. Defaults to true.

                this.emitClose = options.emitClose !== false; // Should .destroy() be called after 'finish' (and potentially 'end')

                this.autoDestroy = !!options.autoDestroy; // count buffered requests

                this.bufferedRequestCount = 0; // allocate the first CorkedRequest, there is always
                // one allocated and free to use, and we maintain at most two

                this.corkedRequestsFree = new CorkedRequest(this);
            }

            WritableState.prototype.getBuffer = function getBuffer() {
                var current = this.bufferedRequest;
                var out = [];

                while (current) {
                    out.push(current);
                    current = current.next;
                }

                return out;
            };

            (function () {
                try {
                    Object.defineProperty(WritableState.prototype, 'buffer', {
                        get: internalUtil.deprecate(function writableStateBufferGetter() {
                            return this.getBuffer();
                        }, '_writableState.buffer is deprecated. Use _writableState.getBuffer ' + 'instead.', 'DEP0003')
                    });
                } catch (_) {}
            })(); // Test _writableState for inheritance to account for Duplex streams,
// whose prototype chain only points to Readable.


            var realHasInstance;

            if (typeof Symbol === 'function' && Symbol.hasInstance && typeof Function.prototype[Symbol.hasInstance] === 'function') {
                realHasInstance = Function.prototype[Symbol.hasInstance];
                Object.defineProperty(Writable, Symbol.hasInstance, {
                    value: function value(object) {
                        if (realHasInstance.call(this, object)) return true;
                        if (this !== Writable) return false;
                        return object && object._writableState instanceof WritableState;
                    }
                });
            } else {
                realHasInstance = function realHasInstance(object) {
                    return object instanceof this;
                };
            }

            function Writable(options) {
                Duplex = Duplex || require('./_stream_duplex'); // Writable ctor is applied to Duplexes, too.
                // `realHasInstance` is necessary because using plain `instanceof`
                // would return false, as no `_writableState` property is attached.
                // Trying to use the custom `instanceof` for Writable here will also break the
                // Node.js LazyTransform implementation, which has a non-trivial getter for
                // `_writableState` that would lead to infinite recursion.
                // Checking for a Stream.Duplex instance is faster here instead of inside
                // the WritableState constructor, at least with V8 6.5

                var isDuplex = this instanceof Duplex;
                if (!isDuplex && !realHasInstance.call(Writable, this)) return new Writable(options);
                this._writableState = new WritableState(options, this, isDuplex); // legacy.

                this.writable = true;

                if (options) {
                    if (typeof options.write === 'function') this._write = options.write;
                    if (typeof options.writev === 'function') this._writev = options.writev;
                    if (typeof options.destroy === 'function') this._destroy = options.destroy;
                    if (typeof options.final === 'function') this._final = options.final;
                }

                Stream.call(this);
            } // Otherwise people can pipe Writable streams, which is just wrong.


            Writable.prototype.pipe = function () {
                errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE());
            };

            function writeAfterEnd(stream, cb) {
                var er = new ERR_STREAM_WRITE_AFTER_END(); // TODO: defer error events consistently everywhere, not just the cb

                errorOrDestroy(stream, er);
                process.nextTick(cb, er);
            } // Checks that a user-supplied chunk is valid, especially for the particular
// mode the stream is in. Currently this means that `null` is never accepted
// and undefined/non-string values are only allowed in object mode.


            function validChunk(stream, state, chunk, cb) {
                var er;

                if (chunk === null) {
                    er = new ERR_STREAM_NULL_VALUES();
                } else if (typeof chunk !== 'string' && !state.objectMode) {
                    er = new ERR_INVALID_ARG_TYPE('chunk', ['string', 'Buffer'], chunk);
                }

                if (er) {
                    errorOrDestroy(stream, er);
                    process.nextTick(cb, er);
                    return false;
                }

                return true;
            }

            Writable.prototype.write = function (chunk, encoding, cb) {
                var state = this._writableState;
                var ret = false;

                var isBuf = !state.objectMode && _isUint8Array(chunk);

                if (isBuf && !Buffer.isBuffer(chunk)) {
                    chunk = _uint8ArrayToBuffer(chunk);
                }

                if (typeof encoding === 'function') {
                    cb = encoding;
                    encoding = null;
                }

                if (isBuf) encoding = 'buffer';else if (!encoding) encoding = state.defaultEncoding;
                if (typeof cb !== 'function') cb = nop;
                if (state.ending) writeAfterEnd(this, cb);else if (isBuf || validChunk(this, state, chunk, cb)) {
                    state.pendingcb++;
                    ret = writeOrBuffer(this, state, isBuf, chunk, encoding, cb);
                }
                return ret;
            };

            Writable.prototype.cork = function () {
                this._writableState.corked++;
            };

            Writable.prototype.uncork = function () {
                var state = this._writableState;

                if (state.corked) {
                    state.corked--;
                    if (!state.writing && !state.corked && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
                }
            };

            Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
                // node::ParseEncoding() requires lower case.
                if (typeof encoding === 'string') encoding = encoding.toLowerCase();
                if (!(['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le', 'raw'].indexOf((encoding + '').toLowerCase()) > -1)) throw new ERR_UNKNOWN_ENCODING(encoding);
                this._writableState.defaultEncoding = encoding;
                return this;
            };

            Object.defineProperty(Writable.prototype, 'writableBuffer', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    return this._writableState && this._writableState.getBuffer();
                }
            });

            function decodeChunk(state, chunk, encoding) {
                if (!state.objectMode && state.decodeStrings !== false && typeof chunk === 'string') {
                    chunk = Buffer.from(chunk, encoding);
                }

                return chunk;
            }

            Object.defineProperty(Writable.prototype, 'writableHighWaterMark', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    return this._writableState.highWaterMark;
                }
            }); // if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.

            function writeOrBuffer(stream, state, isBuf, chunk, encoding, cb) {
                if (!isBuf) {
                    var newChunk = decodeChunk(state, chunk, encoding);

                    if (chunk !== newChunk) {
                        isBuf = true;
                        encoding = 'buffer';
                        chunk = newChunk;
                    }
                }

                var len = state.objectMode ? 1 : chunk.length;
                state.length += len;
                var ret = state.length < state.highWaterMark; // we must ensure that previous needDrain will not be reset to false.

                if (!ret) state.needDrain = true;

                if (state.writing || state.corked) {
                    var last = state.lastBufferedRequest;
                    state.lastBufferedRequest = {
                        chunk: chunk,
                        encoding: encoding,
                        isBuf: isBuf,
                        callback: cb,
                        next: null
                    };

                    if (last) {
                        last.next = state.lastBufferedRequest;
                    } else {
                        state.bufferedRequest = state.lastBufferedRequest;
                    }

                    state.bufferedRequestCount += 1;
                } else {
                    doWrite(stream, state, false, len, chunk, encoding, cb);
                }

                return ret;
            }

            function doWrite(stream, state, writev, len, chunk, encoding, cb) {
                state.writelen = len;
                state.writecb = cb;
                state.writing = true;
                state.sync = true;
                if (state.destroyed) state.onwrite(new ERR_STREAM_DESTROYED('write'));else if (writev) stream._writev(chunk, state.onwrite);else stream._write(chunk, encoding, state.onwrite);
                state.sync = false;
            }

            function onwriteError(stream, state, sync, er, cb) {
                --state.pendingcb;

                if (sync) {
                    // defer the callback if we are being called synchronously
                    // to avoid piling up things on the stack
                    process.nextTick(cb, er); // this can emit finish, and it will always happen
                    // after error

                    process.nextTick(finishMaybe, stream, state);
                    stream._writableState.errorEmitted = true;
                    errorOrDestroy(stream, er);
                } else {
                    // the caller expect this to happen before if
                    // it is async
                    cb(er);
                    stream._writableState.errorEmitted = true;
                    errorOrDestroy(stream, er); // this can emit finish, but finish must
                    // always follow error

                    finishMaybe(stream, state);
                }
            }

            function onwriteStateUpdate(state) {
                state.writing = false;
                state.writecb = null;
                state.length -= state.writelen;
                state.writelen = 0;
            }

            function onwrite(stream, er) {
                var state = stream._writableState;
                var sync = state.sync;
                var cb = state.writecb;
                if (typeof cb !== 'function') throw new ERR_MULTIPLE_CALLBACK();
                onwriteStateUpdate(state);
                if (er) onwriteError(stream, state, sync, er, cb);else {
                    // Check if we're actually ready to finish, but don't emit yet
                    var finished = needFinish(state) || stream.destroyed;

                    if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
                        clearBuffer(stream, state);
                    }

                    if (sync) {
                        process.nextTick(afterWrite, stream, state, finished, cb);
                    } else {
                        afterWrite(stream, state, finished, cb);
                    }
                }
            }

            function afterWrite(stream, state, finished, cb) {
                if (!finished) onwriteDrain(stream, state);
                state.pendingcb--;
                cb();
                finishMaybe(stream, state);
            } // Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.


            function onwriteDrain(stream, state) {
                if (state.length === 0 && state.needDrain) {
                    state.needDrain = false;
                    stream.emit('drain');
                }
            } // if there's something in the buffer waiting, then process it


            function clearBuffer(stream, state) {
                state.bufferProcessing = true;
                var entry = state.bufferedRequest;

                if (stream._writev && entry && entry.next) {
                    // Fast case, write everything using _writev()
                    var l = state.bufferedRequestCount;
                    var buffer = new Array(l);
                    var holder = state.corkedRequestsFree;
                    holder.entry = entry;
                    var count = 0;
                    var allBuffers = true;

                    while (entry) {
                        buffer[count] = entry;
                        if (!entry.isBuf) allBuffers = false;
                        entry = entry.next;
                        count += 1;
                    }

                    buffer.allBuffers = allBuffers;
                    doWrite(stream, state, true, state.length, buffer, '', holder.finish); // doWrite is almost always async, defer these to save a bit of time
                    // as the hot path ends with doWrite

                    state.pendingcb++;
                    state.lastBufferedRequest = null;

                    if (holder.next) {
                        state.corkedRequestsFree = holder.next;
                        holder.next = null;
                    } else {
                        state.corkedRequestsFree = new CorkedRequest(state);
                    }

                    state.bufferedRequestCount = 0;
                } else {
                    // Slow case, write chunks one-by-one
                    while (entry) {
                        var chunk = entry.chunk;
                        var encoding = entry.encoding;
                        var cb = entry.callback;
                        var len = state.objectMode ? 1 : chunk.length;
                        doWrite(stream, state, false, len, chunk, encoding, cb);
                        entry = entry.next;
                        state.bufferedRequestCount--; // if we didn't call the onwrite immediately, then
                        // it means that we need to wait until it does.
                        // also, that means that the chunk and cb are currently
                        // being processed, so move the buffer counter past them.

                        if (state.writing) {
                            break;
                        }
                    }

                    if (entry === null) state.lastBufferedRequest = null;
                }

                state.bufferedRequest = entry;
                state.bufferProcessing = false;
            }

            Writable.prototype._write = function (chunk, encoding, cb) {
                cb(new ERR_METHOD_NOT_IMPLEMENTED('_write()'));
            };

            Writable.prototype._writev = null;

            Writable.prototype.end = function (chunk, encoding, cb) {
                var state = this._writableState;

                if (typeof chunk === 'function') {
                    cb = chunk;
                    chunk = null;
                    encoding = null;
                } else if (typeof encoding === 'function') {
                    cb = encoding;
                    encoding = null;
                }

                if (chunk !== null && chunk !== undefined) this.write(chunk, encoding); // .end() fully uncorks

                if (state.corked) {
                    state.corked = 1;
                    this.uncork();
                } // ignore unnecessary end() calls.


                if (!state.ending) endWritable(this, state, cb);
                return this;
            };

            Object.defineProperty(Writable.prototype, 'writableLength', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    return this._writableState.length;
                }
            });

            function needFinish(state) {
                return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
            }

            function callFinal(stream, state) {
                stream._final(function (err) {
                    state.pendingcb--;

                    if (err) {
                        errorOrDestroy(stream, err);
                    }

                    state.prefinished = true;
                    stream.emit('prefinish');
                    finishMaybe(stream, state);
                });
            }

            function prefinish(stream, state) {
                if (!state.prefinished && !state.finalCalled) {
                    if (typeof stream._final === 'function' && !state.destroyed) {
                        state.pendingcb++;
                        state.finalCalled = true;
                        process.nextTick(callFinal, stream, state);
                    } else {
                        state.prefinished = true;
                        stream.emit('prefinish');
                    }
                }
            }

            function finishMaybe(stream, state) {
                var need = needFinish(state);

                if (need) {
                    prefinish(stream, state);

                    if (state.pendingcb === 0) {
                        state.finished = true;
                        stream.emit('finish');

                        if (state.autoDestroy) {
                            // In case of duplex streams we need a way to detect
                            // if the readable side is ready for autoDestroy as well
                            var rState = stream._readableState;

                            if (!rState || rState.autoDestroy && rState.endEmitted) {
                                stream.destroy();
                            }
                        }
                    }
                }

                return need;
            }

            function endWritable(stream, state, cb) {
                state.ending = true;
                finishMaybe(stream, state);

                if (cb) {
                    if (state.finished) process.nextTick(cb);else stream.once('finish', cb);
                }

                state.ended = true;
                stream.writable = false;
            }

            function onCorkedFinish(corkReq, state, err) {
                var entry = corkReq.entry;
                corkReq.entry = null;

                while (entry) {
                    var cb = entry.callback;
                    state.pendingcb--;
                    cb(err);
                    entry = entry.next;
                } // reuse the free corkReq.


                state.corkedRequestsFree.next = corkReq;
            }

            Object.defineProperty(Writable.prototype, 'destroyed', {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                    if (this._writableState === undefined) {
                        return false;
                    }

                    return this._writableState.destroyed;
                },
                set: function set(value) {
                    // we ignore the value if the stream
                    // has not been initialized yet
                    if (!this._writableState) {
                        return;
                    } // backward compatibility, the user is explicitly
                    // managing destroyed


                    this._writableState.destroyed = value;
                }
            });
            Writable.prototype.destroy = destroyImpl.destroy;
            Writable.prototype._undestroy = destroyImpl.undestroy;

            Writable.prototype._destroy = function (err, cb) {
                cb(err);
            };
        }).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

    },{"../errors":19,"./_stream_duplex":20,"./internal/streams/destroy":27,"./internal/streams/state":31,"./internal/streams/stream":32,"_process":14,"buffer":11,"inherits":16,"util-deprecate":34}],25:[function(require,module,exports){
        (function (process){(function (){
            'use strict';

            var _Object$setPrototypeO;

            function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

            var finished = require('./end-of-stream');

            var kLastResolve = Symbol('lastResolve');
            var kLastReject = Symbol('lastReject');
            var kError = Symbol('error');
            var kEnded = Symbol('ended');
            var kLastPromise = Symbol('lastPromise');
            var kHandlePromise = Symbol('handlePromise');
            var kStream = Symbol('stream');

            function createIterResult(value, done) {
                return {
                    value: value,
                    done: done
                };
            }

            function readAndResolve(iter) {
                var resolve = iter[kLastResolve];

                if (resolve !== null) {
                    var data = iter[kStream].read(); // we defer if data is null
                    // we can be expecting either 'end' or
                    // 'error'

                    if (data !== null) {
                        iter[kLastPromise] = null;
                        iter[kLastResolve] = null;
                        iter[kLastReject] = null;
                        resolve(createIterResult(data, false));
                    }
                }
            }

            function onReadable(iter) {
                // we wait for the next tick, because it might
                // emit an error with process.nextTick
                process.nextTick(readAndResolve, iter);
            }

            function wrapForNext(lastPromise, iter) {
                return function (resolve, reject) {
                    lastPromise.then(function () {
                        if (iter[kEnded]) {
                            resolve(createIterResult(undefined, true));
                            return;
                        }

                        iter[kHandlePromise](resolve, reject);
                    }, reject);
                };
            }

            var AsyncIteratorPrototype = Object.getPrototypeOf(function () {});
            var ReadableStreamAsyncIteratorPrototype = Object.setPrototypeOf((_Object$setPrototypeO = {
                get stream() {
                    return this[kStream];
                },

                next: function next() {
                    var _this = this;

                    // if we have detected an error in the meanwhile
                    // reject straight away
                    var error = this[kError];

                    if (error !== null) {
                        return Promise.reject(error);
                    }

                    if (this[kEnded]) {
                        return Promise.resolve(createIterResult(undefined, true));
                    }

                    if (this[kStream].destroyed) {
                        // We need to defer via nextTick because if .destroy(err) is
                        // called, the error will be emitted via nextTick, and
                        // we cannot guarantee that there is no error lingering around
                        // waiting to be emitted.
                        return new Promise(function (resolve, reject) {
                            process.nextTick(function () {
                                if (_this[kError]) {
                                    reject(_this[kError]);
                                } else {
                                    resolve(createIterResult(undefined, true));
                                }
                            });
                        });
                    } // if we have multiple next() calls
                    // we will wait for the previous Promise to finish
                    // this logic is optimized to support for await loops,
                    // where next() is only called once at a time


                    var lastPromise = this[kLastPromise];
                    var promise;

                    if (lastPromise) {
                        promise = new Promise(wrapForNext(lastPromise, this));
                    } else {
                        // fast path needed to support multiple this.push()
                        // without triggering the next() queue
                        var data = this[kStream].read();

                        if (data !== null) {
                            return Promise.resolve(createIterResult(data, false));
                        }

                        promise = new Promise(this[kHandlePromise]);
                    }

                    this[kLastPromise] = promise;
                    return promise;
                }
            }, _defineProperty(_Object$setPrototypeO, Symbol.asyncIterator, function () {
                return this;
            }), _defineProperty(_Object$setPrototypeO, "return", function _return() {
                var _this2 = this;

                // destroy(err, cb) is a private API
                // we can guarantee we have that here, because we control the
                // Readable class this is attached to
                return new Promise(function (resolve, reject) {
                    _this2[kStream].destroy(null, function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        resolve(createIterResult(undefined, true));
                    });
                });
            }), _Object$setPrototypeO), AsyncIteratorPrototype);

            var createReadableStreamAsyncIterator = function createReadableStreamAsyncIterator(stream) {
                var _Object$create;

                var iterator = Object.create(ReadableStreamAsyncIteratorPrototype, (_Object$create = {}, _defineProperty(_Object$create, kStream, {
                    value: stream,
                    writable: true
                }), _defineProperty(_Object$create, kLastResolve, {
                    value: null,
                    writable: true
                }), _defineProperty(_Object$create, kLastReject, {
                    value: null,
                    writable: true
                }), _defineProperty(_Object$create, kError, {
                    value: null,
                    writable: true
                }), _defineProperty(_Object$create, kEnded, {
                    value: stream._readableState.endEmitted,
                    writable: true
                }), _defineProperty(_Object$create, kHandlePromise, {
                    value: function value(resolve, reject) {
                        var data = iterator[kStream].read();

                        if (data) {
                            iterator[kLastPromise] = null;
                            iterator[kLastResolve] = null;
                            iterator[kLastReject] = null;
                            resolve(createIterResult(data, false));
                        } else {
                            iterator[kLastResolve] = resolve;
                            iterator[kLastReject] = reject;
                        }
                    },
                    writable: true
                }), _Object$create));
                iterator[kLastPromise] = null;
                finished(stream, function (err) {
                    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
                        var reject = iterator[kLastReject]; // reject if we are waiting for data in the Promise
                        // returned by next() and store the error

                        if (reject !== null) {
                            iterator[kLastPromise] = null;
                            iterator[kLastResolve] = null;
                            iterator[kLastReject] = null;
                            reject(err);
                        }

                        iterator[kError] = err;
                        return;
                    }

                    var resolve = iterator[kLastResolve];

                    if (resolve !== null) {
                        iterator[kLastPromise] = null;
                        iterator[kLastResolve] = null;
                        iterator[kLastReject] = null;
                        resolve(createIterResult(undefined, true));
                    }

                    iterator[kEnded] = true;
                });
                stream.on('readable', onReadable.bind(null, iterator));
                return iterator;
            };

            module.exports = createReadableStreamAsyncIterator;
        }).call(this)}).call(this,require('_process'))

    },{"./end-of-stream":28,"_process":14}],26:[function(require,module,exports){
        'use strict';

        function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

        function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(Object(source), true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

        function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

        function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

        function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

        function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

        var _require = require('buffer'),
            Buffer = _require.Buffer;

        var _require2 = require('util'),
            inspect = _require2.inspect;

        var custom = inspect && inspect.custom || 'inspect';

        function copyBuffer(src, target, offset) {
            Buffer.prototype.copy.call(src, target, offset);
        }

        module.exports =
            /*#__PURE__*/
            function () {
                function BufferList() {
                    _classCallCheck(this, BufferList);

                    this.head = null;
                    this.tail = null;
                    this.length = 0;
                }

                _createClass(BufferList, [{
                    key: "push",
                    value: function push(v) {
                        var entry = {
                            data: v,
                            next: null
                        };
                        if (this.length > 0) this.tail.next = entry;else this.head = entry;
                        this.tail = entry;
                        ++this.length;
                    }
                }, {
                    key: "unshift",
                    value: function unshift(v) {
                        var entry = {
                            data: v,
                            next: this.head
                        };
                        if (this.length === 0) this.tail = entry;
                        this.head = entry;
                        ++this.length;
                    }
                }, {
                    key: "shift",
                    value: function shift() {
                        if (this.length === 0) return;
                        var ret = this.head.data;
                        if (this.length === 1) this.head = this.tail = null;else this.head = this.head.next;
                        --this.length;
                        return ret;
                    }
                }, {
                    key: "clear",
                    value: function clear() {
                        this.head = this.tail = null;
                        this.length = 0;
                    }
                }, {
                    key: "join",
                    value: function join(s) {
                        if (this.length === 0) return '';
                        var p = this.head;
                        var ret = '' + p.data;

                        while (p = p.next) {
                            ret += s + p.data;
                        }

                        return ret;
                    }
                }, {
                    key: "concat",
                    value: function concat(n) {
                        if (this.length === 0) return Buffer.alloc(0);
                        var ret = Buffer.allocUnsafe(n >>> 0);
                        var p = this.head;
                        var i = 0;

                        while (p) {
                            copyBuffer(p.data, ret, i);
                            i += p.data.length;
                            p = p.next;
                        }

                        return ret;
                    } // Consumes a specified amount of bytes or characters from the buffered data.

                }, {
                    key: "consume",
                    value: function consume(n, hasStrings) {
                        var ret;

                        if (n < this.head.data.length) {
                            // `slice` is the same for buffers and strings.
                            ret = this.head.data.slice(0, n);
                            this.head.data = this.head.data.slice(n);
                        } else if (n === this.head.data.length) {
                            // First chunk is a perfect match.
                            ret = this.shift();
                        } else {
                            // Result spans more than one buffer.
                            ret = hasStrings ? this._getString(n) : this._getBuffer(n);
                        }

                        return ret;
                    }
                }, {
                    key: "first",
                    value: function first() {
                        return this.head.data;
                    } // Consumes a specified amount of characters from the buffered data.

                }, {
                    key: "_getString",
                    value: function _getString(n) {
                        var p = this.head;
                        var c = 1;
                        var ret = p.data;
                        n -= ret.length;

                        while (p = p.next) {
                            var str = p.data;
                            var nb = n > str.length ? str.length : n;
                            if (nb === str.length) ret += str;else ret += str.slice(0, n);
                            n -= nb;

                            if (n === 0) {
                                if (nb === str.length) {
                                    ++c;
                                    if (p.next) this.head = p.next;else this.head = this.tail = null;
                                } else {
                                    this.head = p;
                                    p.data = str.slice(nb);
                                }

                                break;
                            }

                            ++c;
                        }

                        this.length -= c;
                        return ret;
                    } // Consumes a specified amount of bytes from the buffered data.

                }, {
                    key: "_getBuffer",
                    value: function _getBuffer(n) {
                        var ret = Buffer.allocUnsafe(n);
                        var p = this.head;
                        var c = 1;
                        p.data.copy(ret);
                        n -= p.data.length;

                        while (p = p.next) {
                            var buf = p.data;
                            var nb = n > buf.length ? buf.length : n;
                            buf.copy(ret, ret.length - n, 0, nb);
                            n -= nb;

                            if (n === 0) {
                                if (nb === buf.length) {
                                    ++c;
                                    if (p.next) this.head = p.next;else this.head = this.tail = null;
                                } else {
                                    this.head = p;
                                    p.data = buf.slice(nb);
                                }

                                break;
                            }

                            ++c;
                        }

                        this.length -= c;
                        return ret;
                    } // Make sure the linked list only shows the minimal necessary information.

                }, {
                    key: custom,
                    value: function value(_, options) {
                        return inspect(this, _objectSpread({}, options, {
                            // Only inspect one level.
                            depth: 0,
                            // It should not recurse.
                            customInspect: false
                        }));
                    }
                }]);

                return BufferList;
            }();
    },{"buffer":11,"util":9}],27:[function(require,module,exports){
        (function (process){(function (){
            'use strict'; // undocumented cb() API, needed for core, not for public API

            function destroy(err, cb) {
                var _this = this;

                var readableDestroyed = this._readableState && this._readableState.destroyed;
                var writableDestroyed = this._writableState && this._writableState.destroyed;

                if (readableDestroyed || writableDestroyed) {
                    if (cb) {
                        cb(err);
                    } else if (err) {
                        if (!this._writableState) {
                            process.nextTick(emitErrorNT, this, err);
                        } else if (!this._writableState.errorEmitted) {
                            this._writableState.errorEmitted = true;
                            process.nextTick(emitErrorNT, this, err);
                        }
                    }

                    return this;
                } // we set destroyed to true before firing error callbacks in order
                // to make it re-entrance safe in case destroy() is called within callbacks


                if (this._readableState) {
                    this._readableState.destroyed = true;
                } // if this is a duplex stream mark the writable part as destroyed as well


                if (this._writableState) {
                    this._writableState.destroyed = true;
                }

                this._destroy(err || null, function (err) {
                    if (!cb && err) {
                        if (!_this._writableState) {
                            process.nextTick(emitErrorAndCloseNT, _this, err);
                        } else if (!_this._writableState.errorEmitted) {
                            _this._writableState.errorEmitted = true;
                            process.nextTick(emitErrorAndCloseNT, _this, err);
                        } else {
                            process.nextTick(emitCloseNT, _this);
                        }
                    } else if (cb) {
                        process.nextTick(emitCloseNT, _this);
                        cb(err);
                    } else {
                        process.nextTick(emitCloseNT, _this);
                    }
                });

                return this;
            }

            function emitErrorAndCloseNT(self, err) {
                emitErrorNT(self, err);
                emitCloseNT(self);
            }

            function emitCloseNT(self) {
                if (self._writableState && !self._writableState.emitClose) return;
                if (self._readableState && !self._readableState.emitClose) return;
                self.emit('close');
            }

            function undestroy() {
                if (this._readableState) {
                    this._readableState.destroyed = false;
                    this._readableState.reading = false;
                    this._readableState.ended = false;
                    this._readableState.endEmitted = false;
                }

                if (this._writableState) {
                    this._writableState.destroyed = false;
                    this._writableState.ended = false;
                    this._writableState.ending = false;
                    this._writableState.finalCalled = false;
                    this._writableState.prefinished = false;
                    this._writableState.finished = false;
                    this._writableState.errorEmitted = false;
                }
            }

            function emitErrorNT(self, err) {
                self.emit('error', err);
            }

            function errorOrDestroy(stream, err) {
                // We have tests that rely on errors being emitted
                // in the same tick, so changing this is semver major.
                // For now when you opt-in to autoDestroy we allow
                // the error to be emitted nextTick. In a future
                // semver major update we should change the default to this.
                var rState = stream._readableState;
                var wState = stream._writableState;
                if (rState && rState.autoDestroy || wState && wState.autoDestroy) stream.destroy(err);else stream.emit('error', err);
            }

            module.exports = {
                destroy: destroy,
                undestroy: undestroy,
                errorOrDestroy: errorOrDestroy
            };
        }).call(this)}).call(this,require('_process'))

    },{"_process":14}],28:[function(require,module,exports){
// Ported from https://github.com/mafintosh/end-of-stream with
// permission from the author, Mathias Buus (@mafintosh).
        'use strict';

        var ERR_STREAM_PREMATURE_CLOSE = require('../../../errors').codes.ERR_STREAM_PREMATURE_CLOSE;

        function once(callback) {
            var called = false;
            return function () {
                if (called) return;
                called = true;

                for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
                    args[_key] = arguments[_key];
                }

                callback.apply(this, args);
            };
        }

        function noop() {}

        function isRequest(stream) {
            return stream.setHeader && typeof stream.abort === 'function';
        }

        function eos(stream, opts, callback) {
            if (typeof opts === 'function') return eos(stream, null, opts);
            if (!opts) opts = {};
            callback = once(callback || noop);
            var readable = opts.readable || opts.readable !== false && stream.readable;
            var writable = opts.writable || opts.writable !== false && stream.writable;

            var onlegacyfinish = function onlegacyfinish() {
                if (!stream.writable) onfinish();
            };

            var writableEnded = stream._writableState && stream._writableState.finished;

            var onfinish = function onfinish() {
                writable = false;
                writableEnded = true;
                if (!readable) callback.call(stream);
            };

            var readableEnded = stream._readableState && stream._readableState.endEmitted;

            var onend = function onend() {
                readable = false;
                readableEnded = true;
                if (!writable) callback.call(stream);
            };

            var onerror = function onerror(err) {
                callback.call(stream, err);
            };

            var onclose = function onclose() {
                var err;

                if (readable && !readableEnded) {
                    if (!stream._readableState || !stream._readableState.ended) err = new ERR_STREAM_PREMATURE_CLOSE();
                    return callback.call(stream, err);
                }

                if (writable && !writableEnded) {
                    if (!stream._writableState || !stream._writableState.ended) err = new ERR_STREAM_PREMATURE_CLOSE();
                    return callback.call(stream, err);
                }
            };

            var onrequest = function onrequest() {
                stream.req.on('finish', onfinish);
            };

            if (isRequest(stream)) {
                stream.on('complete', onfinish);
                stream.on('abort', onclose);
                if (stream.req) onrequest();else stream.on('request', onrequest);
            } else if (writable && !stream._writableState) {
                // legacy streams
                stream.on('end', onlegacyfinish);
                stream.on('close', onlegacyfinish);
            }

            stream.on('end', onend);
            stream.on('finish', onfinish);
            if (opts.error !== false) stream.on('error', onerror);
            stream.on('close', onclose);
            return function () {
                stream.removeListener('complete', onfinish);
                stream.removeListener('abort', onclose);
                stream.removeListener('request', onrequest);
                if (stream.req) stream.req.removeListener('finish', onfinish);
                stream.removeListener('end', onlegacyfinish);
                stream.removeListener('close', onlegacyfinish);
                stream.removeListener('finish', onfinish);
                stream.removeListener('end', onend);
                stream.removeListener('error', onerror);
                stream.removeListener('close', onclose);
            };
        }

        module.exports = eos;
    },{"../../../errors":19}],29:[function(require,module,exports){
        module.exports = function () {
            throw new Error('Readable.from is not available in the browser')
        };

    },{}],30:[function(require,module,exports){
// Ported from https://github.com/mafintosh/pump with
// permission from the author, Mathias Buus (@mafintosh).
        'use strict';

        var eos;

        function once(callback) {
            var called = false;
            return function () {
                if (called) return;
                called = true;
                callback.apply(void 0, arguments);
            };
        }

        var _require$codes = require('../../../errors').codes,
            ERR_MISSING_ARGS = _require$codes.ERR_MISSING_ARGS,
            ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED;

        function noop(err) {
            // Rethrow the error if it exists to avoid swallowing it
            if (err) throw err;
        }

        function isRequest(stream) {
            return stream.setHeader && typeof stream.abort === 'function';
        }

        function destroyer(stream, reading, writing, callback) {
            callback = once(callback);
            var closed = false;
            stream.on('close', function () {
                closed = true;
            });
            if (eos === undefined) eos = require('./end-of-stream');
            eos(stream, {
                readable: reading,
                writable: writing
            }, function (err) {
                if (err) return callback(err);
                closed = true;
                callback();
            });
            var destroyed = false;
            return function (err) {
                if (closed) return;
                if (destroyed) return;
                destroyed = true; // request.destroy just do .end - .abort is what we want

                if (isRequest(stream)) return stream.abort();
                if (typeof stream.destroy === 'function') return stream.destroy();
                callback(err || new ERR_STREAM_DESTROYED('pipe'));
            };
        }

        function call(fn) {
            fn();
        }

        function pipe(from, to) {
            return from.pipe(to);
        }

        function popCallback(streams) {
            if (!streams.length) return noop;
            if (typeof streams[streams.length - 1] !== 'function') return noop;
            return streams.pop();
        }

        function pipeline() {
            for (var _len = arguments.length, streams = new Array(_len), _key = 0; _key < _len; _key++) {
                streams[_key] = arguments[_key];
            }

            var callback = popCallback(streams);
            if (Array.isArray(streams[0])) streams = streams[0];

            if (streams.length < 2) {
                throw new ERR_MISSING_ARGS('streams');
            }

            var error;
            var destroys = streams.map(function (stream, i) {
                var reading = i < streams.length - 1;
                var writing = i > 0;
                return destroyer(stream, reading, writing, function (err) {
                    if (!error) error = err;
                    if (err) destroys.forEach(call);
                    if (reading) return;
                    destroys.forEach(call);
                    callback(error);
                });
            });
            return streams.reduce(pipe);
        }

        module.exports = pipeline;
    },{"../../../errors":19,"./end-of-stream":28}],31:[function(require,module,exports){
        'use strict';

        var ERR_INVALID_OPT_VALUE = require('../../../errors').codes.ERR_INVALID_OPT_VALUE;

        function highWaterMarkFrom(options, isDuplex, duplexKey) {
            return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
        }

        function getHighWaterMark(state, options, duplexKey, isDuplex) {
            var hwm = highWaterMarkFrom(options, isDuplex, duplexKey);

            if (hwm != null) {
                if (!(isFinite(hwm) && Math.floor(hwm) === hwm) || hwm < 0) {
                    var name = isDuplex ? duplexKey : 'highWaterMark';
                    throw new ERR_INVALID_OPT_VALUE(name, hwm);
                }

                return Math.floor(hwm);
            } // Default value


            return state.objectMode ? 16 : 16 * 1024;
        }

        module.exports = {
            getHighWaterMark: getHighWaterMark
        };
    },{"../../../errors":19}],32:[function(require,module,exports){
        module.exports = require('events').EventEmitter;

    },{"events":10}],33:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

        'use strict';

        /*<replacement>*/

        var Buffer = require('safe-buffer').Buffer;
        /*</replacement>*/

        var isEncoding = Buffer.isEncoding || function (encoding) {
            encoding = '' + encoding;
            switch (encoding && encoding.toLowerCase()) {
                case 'hex':case 'utf8':case 'utf-8':case 'ascii':case 'binary':case 'base64':case 'ucs2':case 'ucs-2':case 'utf16le':case 'utf-16le':case 'raw':
                    return true;
                default:
                    return false;
            }
        };

        function _normalizeEncoding(enc) {
            if (!enc) return 'utf8';
            var retried;
            while (true) {
                switch (enc) {
                    case 'utf8':
                    case 'utf-8':
                        return 'utf8';
                    case 'ucs2':
                    case 'ucs-2':
                    case 'utf16le':
                    case 'utf-16le':
                        return 'utf16le';
                    case 'latin1':
                    case 'binary':
                        return 'latin1';
                    case 'base64':
                    case 'ascii':
                    case 'hex':
                        return enc;
                    default:
                        if (retried) return; // undefined
                        enc = ('' + enc).toLowerCase();
                        retried = true;
                }
            }
        };

// Do not cache `Buffer.isEncoding` when checking encoding names as some
// modules monkey-patch it to support additional encodings
        function normalizeEncoding(enc) {
            var nenc = _normalizeEncoding(enc);
            if (typeof nenc !== 'string' && (Buffer.isEncoding === isEncoding || !isEncoding(enc))) throw new Error('Unknown encoding: ' + enc);
            return nenc || enc;
        }

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters.
        exports.StringDecoder = StringDecoder;
        function StringDecoder(encoding) {
            this.encoding = normalizeEncoding(encoding);
            var nb;
            switch (this.encoding) {
                case 'utf16le':
                    this.text = utf16Text;
                    this.end = utf16End;
                    nb = 4;
                    break;
                case 'utf8':
                    this.fillLast = utf8FillLast;
                    nb = 4;
                    break;
                case 'base64':
                    this.text = base64Text;
                    this.end = base64End;
                    nb = 3;
                    break;
                default:
                    this.write = simpleWrite;
                    this.end = simpleEnd;
                    return;
            }
            this.lastNeed = 0;
            this.lastTotal = 0;
            this.lastChar = Buffer.allocUnsafe(nb);
        }

        StringDecoder.prototype.write = function (buf) {
            if (buf.length === 0) return '';
            var r;
            var i;
            if (this.lastNeed) {
                r = this.fillLast(buf);
                if (r === undefined) return '';
                i = this.lastNeed;
                this.lastNeed = 0;
            } else {
                i = 0;
            }
            if (i < buf.length) return r ? r + this.text(buf, i) : this.text(buf, i);
            return r || '';
        };

        StringDecoder.prototype.end = utf8End;

// Returns only complete characters in a Buffer
        StringDecoder.prototype.text = utf8Text;

// Attempts to complete a partial non-UTF-8 character using bytes from a Buffer
        StringDecoder.prototype.fillLast = function (buf) {
            if (this.lastNeed <= buf.length) {
                buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
                return this.lastChar.toString(this.encoding, 0, this.lastTotal);
            }
            buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);
            this.lastNeed -= buf.length;
        };

// Checks the type of a UTF-8 byte, whether it's ASCII, a leading byte, or a
// continuation byte. If an invalid byte is detected, -2 is returned.
        function utf8CheckByte(byte) {
            if (byte <= 0x7F) return 0;else if (byte >> 5 === 0x06) return 2;else if (byte >> 4 === 0x0E) return 3;else if (byte >> 3 === 0x1E) return 4;
            return byte >> 6 === 0x02 ? -1 : -2;
        }

// Checks at most 3 bytes at the end of a Buffer in order to detect an
// incomplete multi-byte UTF-8 character. The total number of bytes (2, 3, or 4)
// needed to complete the UTF-8 character (if applicable) are returned.
        function utf8CheckIncomplete(self, buf, i) {
            var j = buf.length - 1;
            if (j < i) return 0;
            var nb = utf8CheckByte(buf[j]);
            if (nb >= 0) {
                if (nb > 0) self.lastNeed = nb - 1;
                return nb;
            }
            if (--j < i || nb === -2) return 0;
            nb = utf8CheckByte(buf[j]);
            if (nb >= 0) {
                if (nb > 0) self.lastNeed = nb - 2;
                return nb;
            }
            if (--j < i || nb === -2) return 0;
            nb = utf8CheckByte(buf[j]);
            if (nb >= 0) {
                if (nb > 0) {
                    if (nb === 2) nb = 0;else self.lastNeed = nb - 3;
                }
                return nb;
            }
            return 0;
        }

// Validates as many continuation bytes for a multi-byte UTF-8 character as
// needed or are available. If we see a non-continuation byte where we expect
// one, we "replace" the validated continuation bytes we've seen so far with
// a single UTF-8 replacement character ('\ufffd'), to match v8's UTF-8 decoding
// behavior. The continuation byte check is included three times in the case
// where all of the continuation bytes for a character exist in the same buffer.
// It is also done this way as a slight performance increase instead of using a
// loop.
        function utf8CheckExtraBytes(self, buf, p) {
            if ((buf[0] & 0xC0) !== 0x80) {
                self.lastNeed = 0;
                return '\ufffd';
            }
            if (self.lastNeed > 1 && buf.length > 1) {
                if ((buf[1] & 0xC0) !== 0x80) {
                    self.lastNeed = 1;
                    return '\ufffd';
                }
                if (self.lastNeed > 2 && buf.length > 2) {
                    if ((buf[2] & 0xC0) !== 0x80) {
                        self.lastNeed = 2;
                        return '\ufffd';
                    }
                }
            }
        }

// Attempts to complete a multi-byte UTF-8 character using bytes from a Buffer.
        function utf8FillLast(buf) {
            var p = this.lastTotal - this.lastNeed;
            var r = utf8CheckExtraBytes(this, buf, p);
            if (r !== undefined) return r;
            if (this.lastNeed <= buf.length) {
                buf.copy(this.lastChar, p, 0, this.lastNeed);
                return this.lastChar.toString(this.encoding, 0, this.lastTotal);
            }
            buf.copy(this.lastChar, p, 0, buf.length);
            this.lastNeed -= buf.length;
        }

// Returns all complete UTF-8 characters in a Buffer. If the Buffer ended on a
// partial character, the character's bytes are buffered until the required
// number of bytes are available.
        function utf8Text(buf, i) {
            var total = utf8CheckIncomplete(this, buf, i);
            if (!this.lastNeed) return buf.toString('utf8', i);
            this.lastTotal = total;
            var end = buf.length - (total - this.lastNeed);
            buf.copy(this.lastChar, 0, end);
            return buf.toString('utf8', i, end);
        }

// For UTF-8, a replacement character is added when ending on a partial
// character.
        function utf8End(buf) {
            var r = buf && buf.length ? this.write(buf) : '';
            if (this.lastNeed) return r + '\ufffd';
            return r;
        }

// UTF-16LE typically needs two bytes per character, but even if we have an even
// number of bytes available, we need to check if we end on a leading/high
// surrogate. In that case, we need to wait for the next two bytes in order to
// decode the last character properly.
        function utf16Text(buf, i) {
            if ((buf.length - i) % 2 === 0) {
                var r = buf.toString('utf16le', i);
                if (r) {
                    var c = r.charCodeAt(r.length - 1);
                    if (c >= 0xD800 && c <= 0xDBFF) {
                        this.lastNeed = 2;
                        this.lastTotal = 4;
                        this.lastChar[0] = buf[buf.length - 2];
                        this.lastChar[1] = buf[buf.length - 1];
                        return r.slice(0, -1);
                    }
                }
                return r;
            }
            this.lastNeed = 1;
            this.lastTotal = 2;
            this.lastChar[0] = buf[buf.length - 1];
            return buf.toString('utf16le', i, buf.length - 1);
        }

// For UTF-16LE we do not explicitly append special replacement characters if we
// end on a partial character, we simply let v8 handle that.
        function utf16End(buf) {
            var r = buf && buf.length ? this.write(buf) : '';
            if (this.lastNeed) {
                var end = this.lastTotal - this.lastNeed;
                return r + this.lastChar.toString('utf16le', 0, end);
            }
            return r;
        }

        function base64Text(buf, i) {
            var n = (buf.length - i) % 3;
            if (n === 0) return buf.toString('base64', i);
            this.lastNeed = 3 - n;
            this.lastTotal = 3;
            if (n === 1) {
                this.lastChar[0] = buf[buf.length - 1];
            } else {
                this.lastChar[0] = buf[buf.length - 2];
                this.lastChar[1] = buf[buf.length - 1];
            }
            return buf.toString('base64', i, buf.length - n);
        }

        function base64End(buf) {
            var r = buf && buf.length ? this.write(buf) : '';
            if (this.lastNeed) return r + this.lastChar.toString('base64', 0, 3 - this.lastNeed);
            return r;
        }

// Pass bytes on through for single-byte encodings (e.g. ascii, latin1, hex)
        function simpleWrite(buf) {
            return buf.toString(this.encoding);
        }

        function simpleEnd(buf) {
            return buf && buf.length ? this.write(buf) : '';
        }
    },{"safe-buffer":17}],34:[function(require,module,exports){
        (function (global){(function (){

            /**
             * Module exports.
             */

            module.exports = deprecate;

            /**
             * Mark that a method should not be used.
             * Returns a modified function which warns once by default.
             *
             * If `localStorage.noDeprecation = true` is set, then it is a no-op.
             *
             * If `localStorage.throwDeprecation = true` is set, then deprecated functions
             * will throw an Error when invoked.
             *
             * If `localStorage.traceDeprecation = true` is set, then deprecated functions
             * will invoke `console.trace()` instead of `console.error()`.
             *
             * @param {Function} fn - the function to deprecate
             * @param {String} msg - the string to print to the console when `fn` is invoked
             * @returns {Function} a new "deprecated" version of `fn`
             * @api public
             */

            function deprecate (fn, msg) {
                if (config('noDeprecation')) {
                    return fn;
                }

                var warned = false;
                function deprecated() {
                    if (!warned) {
                        if (config('throwDeprecation')) {
                            throw new Error(msg);
                        } else if (config('traceDeprecation')) {
                            console.trace(msg);
                        } else {
                            console.warn(msg);
                        }
                        warned = true;
                    }
                    return fn.apply(this, arguments);
                }

                return deprecated;
            }

            /**
             * Checks `localStorage` for boolean values for the given `name`.
             *
             * @param {String} name
             * @returns {Boolean}
             * @api private
             */

            function config (name) {
                // accessing global.localStorage can trigger a DOMException in sandboxed iframes
                try {
                    if (!global.localStorage) return false;
                } catch (_) {
                    return false;
                }
                var val = global.localStorage[name];
                if (null == val) return false;
                return String(val).toLowerCase() === 'true';
            }

        }).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

    },{}]},{},[2])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJhZ2VudC9kdW1wLnRzIiwiYWdlbnQvaW5kZXgudHMiLCJhZ2VudC9wYXRoLnRzIiwiYWdlbnQvcGtkLnRzIiwiYWdlbnQvcGx1Z2lua2l0LnRzIiwiYWdlbnQvdGhyZWFkcy50cyIsImFnZW50L3RyYW5zZmVyLnRzIiwibm9kZV9tb2R1bGVzL2Jhc2U2NC1qcy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9icm93c2VyLXJlc29sdmUvZW1wdHkuanMiLCJub2RlX21vZHVsZXMvZXZlbnRzL2V2ZW50cy5qcyIsIm5vZGVfbW9kdWxlcy9mcmlkYS1idWZmZXIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZnJpZGEtYnVmZmVyL25vZGVfbW9kdWxlcy9idWZmZXIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZnJpZGEtZnMvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZnJpZGEtcHJvY2Vzcy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2luaGVyaXRzL2luaGVyaXRzX2Jyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvc2FmZS1idWZmZXIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvc3RyZWFtLWJyb3dzZXJpZnkvaW5kZXguanMiLCJub2RlX21vZHVsZXMvc3RyZWFtLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3JlYWRhYmxlLXN0cmVhbS9lcnJvcnMtYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9zdHJlYW0tYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcmVhZGFibGUtc3RyZWFtL2xpYi9fc3RyZWFtX2R1cGxleC5qcyIsIm5vZGVfbW9kdWxlcy9zdHJlYW0tYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcmVhZGFibGUtc3RyZWFtL2xpYi9fc3RyZWFtX3Bhc3N0aHJvdWdoLmpzIiwibm9kZV9tb2R1bGVzL3N0cmVhbS1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9yZWFkYWJsZS1zdHJlYW0vbGliL19zdHJlYW1fcmVhZGFibGUuanMiLCJub2RlX21vZHVsZXMvc3RyZWFtLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3JlYWRhYmxlLXN0cmVhbS9saWIvX3N0cmVhbV90cmFuc2Zvcm0uanMiLCJub2RlX21vZHVsZXMvc3RyZWFtLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3JlYWRhYmxlLXN0cmVhbS9saWIvX3N0cmVhbV93cml0YWJsZS5qcyIsIm5vZGVfbW9kdWxlcy9zdHJlYW0tYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcmVhZGFibGUtc3RyZWFtL2xpYi9pbnRlcm5hbC9zdHJlYW1zL2FzeW5jX2l0ZXJhdG9yLmpzIiwibm9kZV9tb2R1bGVzL3N0cmVhbS1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9yZWFkYWJsZS1zdHJlYW0vbGliL2ludGVybmFsL3N0cmVhbXMvYnVmZmVyX2xpc3QuanMiLCJub2RlX21vZHVsZXMvc3RyZWFtLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3JlYWRhYmxlLXN0cmVhbS9saWIvaW50ZXJuYWwvc3RyZWFtcy9kZXN0cm95LmpzIiwibm9kZV9tb2R1bGVzL3N0cmVhbS1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9yZWFkYWJsZS1zdHJlYW0vbGliL2ludGVybmFsL3N0cmVhbXMvZW5kLW9mLXN0cmVhbS5qcyIsIm5vZGVfbW9kdWxlcy9zdHJlYW0tYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcmVhZGFibGUtc3RyZWFtL2xpYi9pbnRlcm5hbC9zdHJlYW1zL2Zyb20tYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9zdHJlYW0tYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcmVhZGFibGUtc3RyZWFtL2xpYi9pbnRlcm5hbC9zdHJlYW1zL3BpcGVsaW5lLmpzIiwibm9kZV9tb2R1bGVzL3N0cmVhbS1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9yZWFkYWJsZS1zdHJlYW0vbGliL2ludGVybmFsL3N0cmVhbXMvc3RhdGUuanMiLCJub2RlX21vZHVsZXMvc3RyZWFtLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3JlYWRhYmxlLXN0cmVhbS9saWIvaW50ZXJuYWwvc3RyZWFtcy9zdHJlYW0tYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9zdHJpbmdfZGVjb2Rlci9saWIvc3RyaW5nX2RlY29kZXIuanMiLCJub2RlX21vZHVsZXMvdXRpbC1kZXByZWNhdGUvYnJvd3Nlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7OztBQ0FBLHlDQUE4QztBQUM5QyxpQ0FBbUM7QUFDbkMsdUNBQTJDO0FBWTNDLE1BQU0sR0FBRyxHQUFZLEVBQUUsQ0FBQztBQUN4QixNQUFNLGdCQUFnQixHQUFHLENBQUMsU0FBUyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBRTdFLFNBQVMsSUFBSTtJQUNYLElBQUk7UUFDRixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUE7UUFDbEIsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLGdCQUFnQixDQUFDLGNBQWMsRUFBRSw4QkFBOEIsQ0FBRSxDQUFBO1FBQzFGLElBQUksY0FBYyxDQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFBO0tBQ3REO0lBQUMsT0FBTyxDQUFDLEVBQUU7S0FFWDtBQUNILENBQUM7QUFFRCxTQUFnQixJQUFJO0lBQ2xCLE9BQU8sZ0JBQVMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO0FBQy9FLENBQUM7QUFGRCxvQkFFQztBQUVNLEtBQUssVUFBVSxJQUFJLENBQUMsTUFBYyxFQUFFO0lBQ3pDLHNCQUFzQjtJQUN0QixNQUFNLEVBQUUsQ0FBQztJQUVULHFCQUFxQjtJQUNyQixnQkFBTSxFQUFFLENBQUM7SUFFVCxNQUFNLE1BQU0sR0FBRyxJQUFJLEVBQUUsQ0FBQztJQUN0QixNQUFNLFVBQVUsR0FBUyxFQUFFLENBQUM7SUFDNUIsS0FBSyxJQUFJLEdBQUcsSUFBSSxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsRUFBRTtRQUMxQyxNQUFNLFFBQVEsR0FBRyxnQkFBUyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNyQyxJQUFJLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUM7WUFDOUIsU0FBUztRQUVYLE1BQU0sSUFBSSxHQUFHLEdBQUcsQ0FBQyxjQUFlLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBcUIsQ0FBQztRQUMvRCxNQUFNLENBQUMsR0FBRyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLFNBQVMsQ0FBQyxHQUFHLElBQUksQ0FBQztRQUV6RCxJQUFJLEdBQUcsQ0FBQyxNQUFNLEVBQUU7WUFDZCxTQUFTO1FBRVgsTUFBTSxtQkFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ3pCLFVBQVUsQ0FBQyxRQUFRLENBQUMsR0FBRyxJQUFJLENBQUM7UUFFNUIsa0JBQWtCO1FBQ2xCLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFFLENBQUMsSUFBSyxDQUFDLE1BQU0sQ0FBQztRQUVyRSxpQkFBaUI7UUFDakIsTUFBTSxPQUFPLEdBQUcsaUJBQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUNuRCxJQUFJLENBQUMsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxTQUFTLEdBQUcsTUFBTSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLENBQUMsQ0FBQztRQUVoRixpQkFBaUI7UUFDakIsSUFBSSxDQUFDLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsU0FBUyxHQUFHLFdBQVcsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxDQUFDLENBQUM7S0FDeEY7SUFFRCxnQkFBTSxFQUFFLENBQUM7SUFFVCxJQUFJLENBQUMsR0FBRyxDQUFDLGNBQWM7UUFDckIsTUFBTSxJQUFJLENBQUMsTUFBTSxFQUFFLFVBQVUsQ0FBQyxDQUFDO0lBRWpDLElBQUksRUFBRSxDQUFDO0lBQ1AsT0FBTyxDQUFDLENBQUM7QUFFWCxDQUFDO0FBMUNELG9CQTBDQztBQUVELEtBQUssVUFBVSxJQUFJLENBQUMsTUFBYyxFQUFFLFVBQWdCO0lBQ2xELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFDO0lBQzVELE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNyRCxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztJQUNqRCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUM7SUFFbkUsTUFBTSxJQUFJLEdBQUcscURBQXFELENBQUM7SUFFbkUsSUFBSSxJQUFZLENBQUM7SUFDakIsT0FBTyxDQUFDLElBQUksR0FBRyxVQUFVLENBQUMsVUFBVSxFQUFFLENBQUMsRUFBRTtRQUN2QyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQzVCLFNBQVM7UUFFWCxNQUFNLFFBQVEsR0FBRyxnQkFBUyxDQUFDLElBQUksQ0FBQywrQkFBK0IsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQ3ZFLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQztZQUN0QixTQUFTO1FBRVgsTUFBTSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUMxQixPQUFPLENBQUMsNkJBQTZCLENBQUMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQ3hELElBQUksTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFDLE1BQU0sRUFBRSxFQUFFO1lBQ2pDLE1BQU0sbUJBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQztTQUMxQjtLQUNGO0FBQ0gsQ0FBQztBQUVELFNBQWdCLE9BQU8sQ0FBQyxDQUFTO0lBQy9CLE1BQU0sRUFBRSxHQUFHLElBQUksT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQzFCLEdBQUcsQ0FBQyxFQUFFLEdBQUcsRUFBRSxDQUFBO0lBQ1gsR0FBRyxDQUFDLGNBQWMsR0FBRyxJQUFJLGNBQWMsQ0FBQyxFQUFFLENBQUMsc0JBQXNCLENBQUMsRUFBRSxnQkFBZ0IsRUFBRSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7QUFDckcsQ0FBQztBQUpELDBCQUlDO0FBRUQsU0FBZ0IsTUFBTTtJQUNwQixNQUFNLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUE7SUFDaEQsTUFBTSxJQUFJLEdBQUcsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDLFVBQVUsRUFBRSxDQUFDLCtCQUErQixDQUFDLFlBQVksQ0FBQyxDQUFBO0lBQzdGLE1BQU0sR0FBRyxHQUFHLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtJQUMxQyxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQTtJQUNoRCxNQUFNLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ3pCLE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxnQ0FBZ0MsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUE7SUFDaEUsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFBO0lBQ2hDLElBQUksQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLEVBQUU7UUFDakIsTUFBTSxNQUFNLEdBQUcsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ25DLE1BQU0seUJBQXlCLEdBQUcsR0FBRyxDQUFBO1FBQ3JDLElBQUksTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDLE9BQU8sRUFBRSxLQUFLLHlCQUF5QjtZQUN2RCxPQUFNO1FBQ1IsT0FBTyxLQUFLLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUE7S0FDaEQ7SUFFRCxNQUFNLEdBQUcsR0FBRyxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUE7SUFDekIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEVBQUUsRUFBRTtRQUM1QixNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3BDLE1BQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLCtCQUErQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUE7UUFDbkYsSUFBSSxNQUFNO1lBQ1IsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFBO0tBQ2hCO0FBQ0gsQ0FBQztBQXZCRCx3QkF1QkM7Ozs7QUNqSUQsSUFBSSxPQUFPLE9BQU8sS0FBSyxXQUFXO0lBQ2hDLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0RBQWdELEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO0FBRW5GLGlDQUE2QztBQUM3QywrQkFBcUQ7QUFDckQsMkNBQWlEO0FBRWpELEdBQUcsQ0FBQyxPQUFPLEdBQUc7SUFDWixJQUFJLEVBQUosV0FBSTtJQUNKLE9BQU8sRUFBUCxjQUFPO0lBQ1AsT0FBTyxFQUFQLG1CQUFPO0lBQ1AsU0FBUyxFQUFULHFCQUFTO0lBQ1QsSUFBSSxFQUFKLFdBQUk7SUFFSixNQUFNO0lBQ04sb0JBQW9CLEVBQXBCLDBCQUFvQjtJQUNwQixNQUFNLEVBQU4sWUFBTTtDQUVQLENBQUE7Ozs7O0FDbEJELE1BQU0sR0FBRyxHQUFHLEdBQUcsQ0FBQTtBQUVmLFNBQWdCLFVBQVUsQ0FBQyxJQUFZLEVBQUUsSUFBWTtJQUNuRCxNQUFNLENBQUMsR0FBRyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3JDLE1BQU0sQ0FBQyxHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7SUFFckMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ1YsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUFFLENBQUMsRUFBRSxDQUFDO0lBQzFCLE9BQU8sQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDOUIsQ0FBQztBQVBELGdDQU9DO0FBRUQsU0FBZ0IsU0FBUyxDQUFDLElBQVk7SUFDcEMsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVE7U0FDekIsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUMseUJBQXlCLEVBQUUsQ0FBQyxRQUFRLEVBQUUsQ0FBQztBQUNwRSxDQUFDO0FBSEQsOEJBR0M7Ozs7O0FDZEQsU0FBZ0IsTUFBTSxDQUFDLEdBQVc7SUFDaEMsTUFBTSxzQ0FBc0MsR0FBRyxDQUFDLENBQUM7SUFDakQsTUFBTSxDQUFDLEdBQUcsTUFBTSxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxzQkFBc0IsQ0FBRSxDQUFDO0lBQ2pFLE1BQU0sTUFBTSxHQUFHLElBQUksY0FBYyxDQUFDLENBQUMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxRQUFRLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQztJQUNoRyxPQUFPLE1BQU0sQ0FBQyxzQ0FBc0MsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQztBQUMzRSxDQUFDO0FBTEQsd0JBS0M7QUFFRCxTQUFnQixvQkFBb0IsQ0FBQyxHQUFXO0lBQzlDLElBQUksV0FBVyxJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUU7UUFDL0IsTUFBTSxFQUFFLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUM7UUFDbkMsTUFBTSxTQUFTLEdBQUcsQ0FBQyx5Q0FBeUMsRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO1FBQ25GLEtBQUssTUFBTSxJQUFJLElBQUksU0FBUyxFQUFFO1lBQzVCLE1BQU0sTUFBTSxHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUMvQixJQUFJLE1BQU0sRUFBRTtnQkFDVixNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDO2dCQUN2QyxNQUFNLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLFVBQVMsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJO29CQUNyRSxvQ0FBb0M7b0JBQ3BDLE9BQU8sR0FBRyxLQUFLLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO3dCQUMxQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxDQUFDO2dCQUNyQyxDQUFDLENBQUMsQ0FBQTtnQkFDRixNQUFNO2FBQ1A7U0FDRjtLQUNGO0FBQ0gsQ0FBQztBQWpCRCxvREFpQkM7Ozs7O0FDdkJELFNBQWdCLE9BQU87SUFDckIsTUFBTSxFQUNKLHNCQUFzQixFQUN0QixRQUFRLEVBQ1IsY0FBYyxFQUNkLFdBQVcsRUFDWCxRQUFRLEVBQ1QsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDO0lBRWpCLE1BQU0sSUFBSSxHQUFHLGNBQWMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUMzQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDLGdCQUFnQixFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDckUsTUFBTSxHQUFHLEdBQUcsUUFBUSxDQUFDLGlCQUFpQixDQUFDLDJDQUEyQyxDQUFDLENBQUM7SUFDcEYsTUFBTSxTQUFTLEdBQUcsV0FBVyxDQUFDLGtDQUFrQyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsQ0FBQztJQUM1RSxNQUFNLE9BQU8sR0FBRyxzQkFBc0IsQ0FBQyxnQkFBZ0IsRUFBRTtTQUN0RCxnQkFBZ0IsRUFBRSxDQUFDLDRCQUE0QixDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQzlELE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUNsQixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsRUFBRSxFQUFFO1FBQ3hDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7S0FDdEU7SUFDRCxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDZixPQUFPLE1BQU0sQ0FBQztBQUNoQixDQUFDO0FBckJELDBCQXFCQztBQUdELFNBQWdCLE1BQU0sQ0FBQyxFQUFVO0lBQy9CLE1BQU0sRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQztJQUUvQyxNQUFNLFVBQVUsR0FBRyxRQUFRLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDbEQsTUFBTSxTQUFTLEdBQUcsV0FBVyxDQUFDLDhCQUE4QixDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUMsQ0FBQztJQUMvRSxVQUFVLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDckIsSUFBSSxDQUFDLFNBQVM7UUFDWixPQUFPLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxLQUFLLENBQUMsOEJBQThCLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQztJQUV2RSxNQUFNLEdBQUcsR0FBRyxTQUFTLENBQUMsNEJBQTRCLENBQUMsRUFBRSxDQUFDO0lBQ3RELElBQUksR0FBRztRQUNMLE9BQU8sT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUU5QixPQUFPLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1FBQ3JDLFNBQVMsQ0FBQywrQ0FBK0MsQ0FBQyxJQUFJLEVBQUUsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO1lBQzdFLE9BQU8sRUFBRSxNQUFNO1lBQ2YsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDO1lBQ3BCLGNBQWMsQ0FBQyxpQkFBaUI7Z0JBQzlCLE1BQU0sR0FBRyxHQUFHLFNBQVMsQ0FBQyx3QkFBd0IsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO2dCQUNsRSxTQUFTLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQ3BCLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNmLENBQUM7U0FDRixDQUFDLENBQUMsQ0FBQTtJQUNMLENBQUMsQ0FBQyxDQUFBO0FBQ0osQ0FBQztBQXhCRCx3QkF3QkM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxlQUFlLENBQUMsb0JBQW9CLENBQUMsQ0FBQTtBQUM5RCxXQUFXLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsZUFBZSxDQUFFLEVBQUU7SUFDbEUsT0FBTyxDQUFDLElBQUk7UUFDVixNQUFNLEdBQUcsR0FBVyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxFQUFHLENBQUE7UUFDN0MsSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDLHNCQUFzQixDQUFDO1lBQ3RDLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxTQUFTLENBQUE7SUFDdkIsQ0FBQztDQUNGLENBQUMsQ0FBQTtBQUVGLFNBQWdCLFNBQVM7SUFDdkIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdEQsQ0FBQztBQUZELDhCQUVDOzs7OztBQzlFRCxNQUFNLE9BQU8sR0FBcUIsRUFBRSxDQUFBO0FBQ3BDLEtBQUssSUFBSSxNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsUUFBUSxDQUFDLEVBQUU7SUFDeEMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxHQUFHLElBQUksY0FBYyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FDMUQsd0JBQXdCLEVBQUUsVUFBVSxNQUFNLEVBQUUsQ0FBRSxFQUFFLFNBQVMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7Q0FDeEU7QUFFRCxTQUFnQixNQUFNO0lBQ3BCLEtBQUssSUFBSSxFQUFFLEVBQUUsRUFBRSxJQUFJLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRTtRQUMzQyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFBO0FBQ3ZCLENBQUM7QUFIRCx3QkFHQztBQUVELFNBQWdCLE1BQU07SUFDcEIsS0FBSyxJQUFJLEVBQUUsRUFBRSxFQUFFLElBQUksT0FBTyxDQUFDLGdCQUFnQixFQUFFO1FBQzNDLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUE7QUFDdEIsQ0FBQztBQUhELHdCQUdDOzs7OztBQ2xCRCwyQkFBZ0Q7QUFFaEQsU0FBUyxLQUFLLENBQUMsT0FBWSxFQUFFLElBQW9DO0lBQy9ELElBQUksQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDcEIsSUFBSSxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUNoQyxDQUFDO0FBRUQsU0FBZ0IsTUFBTSxDQUFDLE9BQXNCLEVBQUUsSUFBWTtJQUN6RCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNyRCxNQUFNLGFBQWEsR0FBRyxDQUFDLEdBQUcsSUFBSSxHQUFHLElBQUksQ0FBQztJQUN0QyxNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUM7SUFFekIsS0FBSyxDQUFDO1FBQ0osT0FBTztRQUNQLEtBQUssRUFBRSxPQUFPO1FBQ2QsT0FBTztRQUNQLElBQUk7S0FDTCxDQUFDLENBQUE7SUFFRixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksR0FBRyxhQUFhLENBQUMsQ0FBQztJQUMvQyxNQUFNLElBQUksR0FBRyxJQUFJLEdBQUcsYUFBYSxDQUFDO0lBQ2xDLElBQUksQ0FBQyxHQUFHLE9BQU8sQ0FBQztJQUNoQixJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7SUFFVixPQUFPLENBQUMsRUFBRSxHQUFHLEtBQUssRUFBRTtRQUNsQixLQUFLLENBQUM7WUFDSixPQUFPO1lBQ1AsS0FBSyxFQUFFLE1BQU07WUFDYixPQUFPO1lBQ1AsS0FBSyxFQUFFLENBQUM7U0FDVCxFQUFFLENBQUMsQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQztRQUNuQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztLQUMxQjtJQUVELElBQUksSUFBSSxFQUFFO1FBQ1IsS0FBSyxDQUFDO1lBQ0osT0FBTztZQUNQLEtBQUssRUFBRSxNQUFNO1lBQ2IsT0FBTztZQUNQLEtBQUssRUFBRSxDQUFDO1NBQ1QsRUFBRSxDQUFDLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7S0FDM0I7SUFFRCxJQUFJLENBQUM7UUFDSCxPQUFPO1FBQ1AsS0FBSyxFQUFFLEtBQUs7UUFDWixPQUFPO0tBQ1IsQ0FBQyxDQUFDO0lBRUgsT0FBTyxPQUFPLENBQUM7QUFDakIsQ0FBQztBQTNDRCx3QkEyQ0M7QUFFTSxLQUFLLFVBQVUsUUFBUSxDQUFDLFFBQWdCO0lBQzdDLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3JELE1BQU0sYUFBYSxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDO0lBQ3RDLE1BQU0sT0FBTyxHQUFHLFVBQVUsQ0FBQztJQUMzQixNQUFNLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLEdBQUcsYUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQzVELE1BQU0sTUFBTSxHQUFHLHFCQUFnQixDQUFDLFFBQVEsRUFBRSxFQUFFLGFBQWEsRUFBRSxDQUFDLENBQUM7SUFFN0QsS0FBSyxDQUFDO1FBQ0osT0FBTztRQUNQLEtBQUssRUFBRSxPQUFPO1FBQ2QsT0FBTztRQUNQLFFBQVE7UUFDUixJQUFJLEVBQUU7WUFDSixJQUFJO1lBQ0osT0FBTztZQUNQLE9BQU87WUFDUCxJQUFJO1NBQ0w7S0FDRixDQUFDLENBQUM7SUFFSCxNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFLENBQ3BDLE1BQU07U0FDSCxFQUFFLENBQUMsTUFBTSxFQUFFLENBQUMsS0FBa0IsRUFBRSxFQUFFO1FBQ2pDLEtBQUssQ0FBQztZQUNKLE9BQU87WUFDUCxLQUFLLEVBQUUsTUFBTTtZQUNiLE9BQU87U0FDUixFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ1osQ0FBQyxDQUFDO1NBQ0QsRUFBRSxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUM7U0FDbEIsRUFBRSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO0lBRTFCLElBQUksQ0FBQztRQUNILE9BQU87UUFDUCxLQUFLLEVBQUUsS0FBSztRQUNaLE9BQU87S0FDUixDQUFDLENBQUM7QUFFTCxDQUFDO0FBdENELDRCQXNDQzs7QUMxRkQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hKQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzVkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDcnhEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDMW5CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUMvSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUMxSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN0Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ25tQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN4TUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDeHJCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM5TUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNqTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDeEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkdBO0FBQ0E7QUFDQTtBQUNBOztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUJBO0FBQ0E7O0FDREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDdlNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiJ9
