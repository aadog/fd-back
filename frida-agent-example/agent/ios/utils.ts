export var NSData = ObjC.classes.NSData;
export var NSString = ObjC.classes.NSString;

// @ts-ignore
export function NsStr(str) {
    return ObjC.classes.NSString.stringWithUTF8String_(Memory.allocUtf8String(str));
}

/* NSString -> NSData */

// @ts-ignore
export function NsStr2NsData(nsstr) {
    return nsstr.dataUsingEncoding_(4);
}

/* NSData -> NSString */

// @ts-ignore
export function NsData2NsStr(nsdata) {
    return ObjC.classes.NSString.alloc().initWithData_encoding_(nsdata, 4);
}

/* Print Native Callstack */
export function showCallstack() {
    // @ts-ignore
    console.log(Thread.backtrace(this.context, Backtracer.ACCURATE).map(DebugSymbol.fromAddress).join("\n") + "\n");
}

export function showCallstack1() {
    console.log(ObjC.classes.NSThread.callStackSymbols().toString());
}

export function getScreenSize() {
    var UIScreen = ObjC.classes.UIScreen;
    return UIScreen.mainScreen().bounds()[1];
}

// 获取keychain数据
export function getKeychain() {
    var NSMutableDictionary = ObjC.classes.NSMutableDictionary;
    // @ts-ignore
    var kCFBooleanTrue = ObjC.Object(getExportFunction("d", "kCFBooleanTrue"));
    // @ts-ignore
    var kSecReturnAttributes = ObjC.Object(getExportFunction("d", "kSecReturnAttributes"));
    // @ts-ignore
    var kSecMatchLimitAll = ObjC.Object(getExportFunction("d", "kSecMatchLimitAll"));
    // @ts-ignore
    var kSecMatchLimit = ObjC.Object(getExportFunction("d", "kSecMatchLimit"));
    // @ts-ignore
    var kSecClassGenericPassword = ObjC.Object(getExportFunction("d", "kSecClassGenericPassword"));
    // @ts-ignore
    var kSecClassInternetPassword = ObjC.Object(getExportFunction("d", "kSecClassInternetPassword"));
    // @ts-ignore
    var kSecClassCertificate = ObjC.Object(getExportFunction("d", "kSecClassCertificate"));
    // @ts-ignore
    var kSecClassKey = ObjC.Object(getExportFunction("d", "kSecClassKey"));
    // @ts-ignore
    var kSecClassIdentity = ObjC.Object(getExportFunction("d", "kSecClassIdentity"));
    // @ts-ignore
    var kSecClass = ObjC.Object(getExportFunction("d", "kSecClass"));

    var query = NSMutableDictionary.alloc().init();
    // @ts-ignore
    var SecItemCopyMatching = getExportFunction("f", "SecItemCopyMatching", "int", ["pointer", "pointer"]);
    [kSecClassGenericPassword, kSecClassInternetPassword, kSecClassCertificate, kSecClassKey,
        kSecClassIdentity].forEach(function (secItemClass) {
            query.setObject_forKey_(kCFBooleanTrue, kSecReturnAttributes);
            query.setObject_forKey_(kSecMatchLimitAll, kSecMatchLimit);
            query.setObject_forKey_(secItemClass, kSecClass);
            var result = Memory.alloc(8);
            result.writePointer(ptr(0));
            SecItemCopyMatching(query.handle, result);
            var pt = result.readPointer();
            if (!pt.isNull()) {
                console.log(new ObjC.Object(pt).toString());
            }
        }
    )
}

// @ts-ignore
export function getClassModule(classname) {
    // @ts-ignore
    var objc_getClass = new NativeFunction(Module.findExportByName(null, "objc_getClass"), "pointer", ["pointer"]);
    // @ts-ignore
    var class_getImageName = new NativeFunction(Module.findExportByName(null, "class_getImageName"), "pointer",
        ["pointer"]);
    var class_ = objc_getClass(Memory.allocUtf8String(classname));
    // @ts-ignore
    return Memory.readUtf8String(class_getImageName(class_));
}

// @ts-ignore
export function getAddressModule(address) {
    // @ts-ignore
    var dladdr = new NativeFunction(Module.findExportByName(null, "dladdr"), "int", ["pointer", "pointer"]);
    var info = Memory.alloc(Process.pointerSize * 4);
    dladdr(ptr(address), info);
    return {
        // @ts-ignore
        "fname": Memory.readUtf8String(Memory.readPointer(info)),
        // @ts-ignore
        "fbase": Memory.readPointer(info.add(Process.pointerSize)),
        // @ts-ignore
        "sname": Memory.readUtf8String(Memory.readPointer(info.add(Process.pointerSize * 2))),
        // @ts-ignore
        "saddr": Memory.readPointer(info.add(Process.pointerSize * 3)),
    }
}

/* Get all modules */
function getmodule() {
    // @ts-ignore
    var modules = Process.enumerateModulesSync();
    // @ts-ignore
    return modules.map(function (item) {
        return item['path'];
    });
}


// 强制过证书校验
export function forceTrustCert() {
    // @ts-ignore
    Interceptor.replace(Module.findExportByName(null, 'SecTrustEvaluate'),
        new NativeCallback(function (trust, result) {
            // @ts-ignore
            Memory.writePointer(result, ptr('0x1'));
            console.log('pass SecTrustEvaluate');
            return 0;
        }, 'int', ['pointer', 'pointer'])
    );
    /* 获取app路径下的可执行模块 hook存在以下方法的类
        - evaluateServerTrust:forDomain:
        - allowInvalidCertificates
        - shouldContinueWithInvalidCertificate
    */
    // @ts-ignore
    var apppath = Process.enumerateModulesSync()[0]['path'];
    apppath = apppath.slice(0, apppath.lastIndexOf('/'));
    // @ts-ignore
    getmodule().forEach(function (module, i) {
        if (module.indexOf(apppath) != 0) return;
        // @ts-ignore
        getClassModule(module).forEach(function (classname, j) {
            // @ts-ignore
            getClassModule(classname).forEach(function (methodinfo, k) {
                var name = methodinfo['name'];
                if (name == '- evaluateServerTrust:forDomain:' ||
                    name == '- allowInvalidCertificates' ||
                    name == '- shouldContinueWithInvalidCertificate') {
                    console.log("forcetrustcert " + classname + " " + name);
                    Interceptor.attach(methodinfo['imp'], {
                        onEnter: function (args) {
                            console.log("forcetrustcert " + classname + " " + name);
                        },
                        onLeave: function (retval) {
                            retval.replace(ptr('0x1'));
                        }
                    });
                }
            });
        });
    });
}

export function traceView() {
    var UIApplication = ObjC.classes.UIApplication;
    Interceptor.attach(UIApplication["- sendAction:to:from:forEvent:"].implementation, {
        onEnter: function (args) {
            // @ts-ignore
            var action = Memory.readUtf8String(args[2]);
            // @ts-ignore
            var toobj = ObjC.Object(args[3]);
            // @ts-ignore
            var fromobj = ObjC.Object(args[4]);
            // @ts-ignore
            var event = ObjC.Object(args[5]);
            console.log('SendAction:' + action + ' to:' + toobj.toString() +
                ' from:' + fromobj.toString() + ' forEvent:' + event.toString() + ']');
        }
    });
}
