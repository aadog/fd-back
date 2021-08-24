/*
    * To observe a single class by name:
    *     observeClass('NSString');
    *
    * To dynamically resolve methods to observe (see ApiResolver):
    *     observeSomething('*[* *Password:*]');
    */

var ISA_MASK = ptr('0x0000000ffffffff8');
var ISA_MAGIC_MASK = ptr('0x000003f000000001');
var ISA_MAGIC_VALUE = ptr('0x000001a000000001');

// @ts-ignore
export function observeSomething(pattern) {
    var resolver = new ApiResolver('objc');
    // @ts-ignore
    var things = resolver.enumerateMatchesSync(pattern);
    // @ts-ignore
    things.forEach(function (thing) {
        observeMethod(thing.address, '', thing.name);
    });
}

// @ts-ignore
export function observeClass(name) {
    var k = ObjC.classes[name];
    if (!k) {
        return;
    }
    k.$ownMethods.forEach(function (m) {
        observeMethod(k[m].implementation, name, m);
    });
}

// @ts-ignore
export function observeMethod(impl, name, m) {
    console.log('Observing ' + name + ' ' + m);
    Interceptor.attach(impl, {
        onEnter: function (a) {
            this.log = [];
            this.log.push('(' + a[0] + ') ' + name + ' ' + m);
            if (m.indexOf(':') !== -1) {
                var params = m.split(':');
                params[0] = params[0].split(' ')[1];
                for (var i = 0; i < params.length - 1; i++) {
                    if (isObjC(a[2 + i])) {
                        const theObj = new ObjC.Object(a[2 + i]);
                        this.log.push(params[i] + ': ' + theObj.toString() + ' (' + theObj.$className + ')');
                    } else {
                        this.log.push(params[i] + ': ' + a[2 + i].toString());
                    }
                }
            }

            this.log.push(Thread.backtrace(this.context, Backtracer.ACCURATE)
                .map(DebugSymbol.fromAddress).join("\n"));
        },

        onLeave: function (r) {
            if (isObjC(r)) {
                this.log.push('RET: ' + new ObjC.Object(r).toString());
            } else {
                this.log.push('RET: ' + r.toString());
            }

            console.log(this.log.join('\n') + '\n');
        }
    });
}

// @ts-ignore
export function isObjC(p) {
    var klass = getObjCClassPtr(p);
    return !klass.isNull();
}

// @ts-ignore
export function getObjCClassPtr(p) {
    /*
     * Loosely based on:
     * https://blog.timac.org/2016/1124-testing-if-an-arbitrary-pointer-is-a-valid-objective-c-object/
     */

    if (!isReadable(p)) {
        return NULL;
    }
    var isa = p.readPointer();
    var classP = isa;
    if (classP.and(ISA_MAGIC_MASK).equals(ISA_MAGIC_VALUE)) {
        classP = isa.and(ISA_MASK);
    }
    if (isReadable(classP)) {
        return classP;
    }
    return NULL;
}

// @ts-ignore
export function isReadable(p) {
    try {
        p.readU8();
        return true;
    } catch (e) {
        return false;
    }
}

