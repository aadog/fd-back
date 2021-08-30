export function hook_CC_MD5(callback:(buf:NativePointer,len:number)=>void,callback1:(hash:NativePointer)=>void){
    var CC_MD5=Module.getExportByName(null,"CC_MD5")
    Interceptor.attach(CC_MD5,{
        onEnter:function(args){
            callback(args[0],args[1].toInt32())
        },
        onLeave:function (r){
            callback1(r)
        }
    })
}