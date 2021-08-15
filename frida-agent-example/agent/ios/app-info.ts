/*
 *  Convenience functions to access app info.
 *  Dump key app paths and metadata:
 *      appInfo()
 *
 *  Print contents of Info.plist:
 *      infoDictionary()
 *
 *  Query Info.plist by key:
 *      infoLookup("NSAppTransportSecurity")
 *
 */

// @ts-ignore
export function dictFromNSDictionary(nsDict) {
    var jsDict = {};
    var keys = nsDict.allKeys();
    var count = keys.count();
    for (var i = 0; i < count; i++) {
        var key = keys.objectAtIndex_(i);
        var value = nsDict.objectForKey_(key);
        // @ts-ignore
        jsDict[key.toString()] = value.toString();
    }

    return jsDict;
}

// @ts-ignore
export function arrayFromNSArray(nsArray) {
    var jsArray = [];
    var count = nsArray.count();
    for (var i = 0; i < count; i++) {
        jsArray[i] = nsArray.objectAtIndex_(i).toString();
    }
    return jsArray;
}

export function infoDictionary() {
    if (ObjC.available && "NSBundle" in ObjC.classes) {
        var info = ObjC.classes.NSBundle.mainBundle().infoDictionary();
        return dictFromNSDictionary(info);
    }
    return null;
}

// @ts-ignore
export function infoLookup(key) {
    if (ObjC.available && "NSBundle" in ObjC.classes) {
        var info = ObjC.classes.NSBundle.mainBundle().infoDictionary();
        var value = info.objectForKey_(key);
        if (value === null) {
            return value;
        } else if (value.class().toString() === "__NSCFArray") {
            return arrayFromNSArray(value);
        } else if (value.class().toString() === "__NSCFDictionary") {
            return dictFromNSDictionary(value);
        } else {
            return value.toString();
        }
    }
    return null;
}

export function appInfo() {
    var output = {};
    // @ts-ignore
    output["Name"] = infoLookup("CFBundleName");
    // @ts-ignore
    output["Bundle ID"] = ObjC.classes.NSBundle.mainBundle().bundleIdentifier().toString();
    // @ts-ignore
    output["Version"] = infoLookup("CFBundleVersion");
    // @ts-ignore
    output["Bundle"] = ObjC.classes.NSBundle.mainBundle().bundlePath().toString();
    // @ts-ignore
    output["Data"] = ObjC.classes.NSProcessInfo.processInfo().environment().objectForKey_("HOME").toString();
    // @ts-ignore
    output["Binary"] = ObjC.classes.NSBundle.mainBundle().executablePath().toString();
    return output;
}