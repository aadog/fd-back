export class Box{
    static MapBox = new Map();
    static Uint8Array(fpath:string):Uint8Array{
        var str=Box.Get(fpath)
        var arr = [];
        for (var i = 0, j = str.length; i < j; ++i) {
            arr.push(str.charCodeAt(i));
        }
        var tmpUint8Array = new Uint8Array(arr);
        return tmpUint8Array
    }
    static String(fpath:string):string{
        return Box.Get(fpath)
    }
    static Get(fpath:string):any{
        // @ts-ignore
        fpath=fpath.replaceAll("\\","/")

        if(fpath.startsWith(".")){
            fpath=fpath.replace(".","")
        }
        if(fpath.startsWith("/")){
            fpath=fpath.replace("/","")
        }
        console.log(fpath)
        if(!Box.MapBox.has(fpath)){
            return ""
        }
        return Box.MapBox.get(fpath)
    }
}

