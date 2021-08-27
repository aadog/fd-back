export function dump_ScriptEngine_evalString(ScriptEngineEvalStringPtr:NativePointer){
    Interceptor.attach(ScriptEngineEvalStringPtr,{
        onEnter:function (args) {
            // console.log(args[2].readCString(args[3].toInt32()))
            var script=args[1].readCString(args[2].toInt32())
            if(args[4].toInt32()!=0x00){
                var scriptFileName=args[4].readCString()
                console.log(scriptFileName)
                send({"type":"download","path":scriptFileName,"append":false},args[1].readByteArray(args[2].toInt32()))
            }else{
                console.log(script)
            }

        },
        onLeave:function (r) {

        }
    })
}
export function hook_ScriptEngine_evalString(ScriptEngineEvalStringPtr:NativePointer,callback:(scriptName:String,scriptStrBuffer:String,scriptBuffer:ArrayBuffer)=>void){
    Interceptor.attach(ScriptEngineEvalStringPtr,{
        onEnter:function (args) {
            // console.log(args[2].readCString(args[3].toInt32()))
            var script=args[1].readCString(args[2].toInt32())
            if(args[4].toInt32()!=0x00){
                var scriptFileName=args[4].readCString()
                if(scriptFileName==null){
                    scriptFileName=""
                }
                callback(scriptFileName,script!,args[1].readByteArray(args[2].toInt32())!)
            }else{
                callback("",script!,args[1].readByteArray(args[2].toInt32())!)
            }

        },
        onLeave:function (r) {

        }
    })
}