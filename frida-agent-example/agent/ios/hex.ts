
export function PointerHexString(p:NativePointer,n:number) {
    var hex = []
    for(var i=0;i<n;i++){
        hex.push((p.add(i).readU8() & 0xF).toString(16).toUpperCase());
    }
}