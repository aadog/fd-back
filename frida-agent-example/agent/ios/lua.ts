
export function createFunc_luaL_loadbuffer(loadL_bufferPtr:NativePointer):NativeFunction{
    var luaL_loadbuffer=new NativeFunction(loadL_bufferPtr,"int",["pointer","pointer","size_t","pointer"])
    return luaL_loadbuffer
}
export function createFunc_luaL_lua_pcall(lua_pcallPtr:NativePointer):NativeFunction{
    var lua_pcall=new NativeFunction(lua_pcallPtr,"int",["pointer","int","int","int"])
    return lua_pcall
}
export function dump_luaL_loadbuffer(loadL_bufferPtr:NativePointer){
    Interceptor.attach(loadL_bufferPtr,{
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
export function hook_luaL_loadbuffer(loadL_bufferPtr:NativePointer,callback:(scriptName:String,scriptStrBuffer:NativePointer,scriptLen:number)=>void){
    Interceptor.attach(loadL_bufferPtr,{
        onEnter:function (args) {
            // console.log(args[2].readCString(args[3].toInt32()))
            var script=args[1].readCString(args[2].toInt32())
            if(args[4].toInt32()!=0x00){
                var scriptFileName=args[4].readCString()
                if(scriptFileName==null){
                    scriptFileName=""
                }
                callback(scriptFileName,args[1],args[2].toInt32())
            }else{
                callback("",args[1],args[2].toInt32())
            }

        },
        onLeave:function (r) {

        }
    })
}
export function hook_tolua_tostring(tolua_tostringPtr:NativePointer,callback:(str:string)=>void){
    Interceptor.attach(tolua_tostringPtr,{
        onLeave:function (r) {
            var s=r.readCString()
            if(s!=null){
                callback(s)
            }
        }
    })
}