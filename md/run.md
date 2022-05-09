![](gif/run.webp)

#### 如果进程不存在，并且是Applicatoin,那么将以spawn模式启动

#### run(运行js在webstorm中) 使用方法:
````
run 1.js -devi string -name string

example:

1. fd run 1.js -name 通讯录

2. fd run 1.js -name 通讯录 -jsbyte

3. fd run 1.js -name 通讯录 -devi local

````


#### -restart
- bool 重启进程,并以spawn模式注入

#### -jsbyte
- bool 是否使用编译过的js

#### -pid
- processId

#### -name
- ios is appLabel or Identifier or ProcessName
- ios is appLabel or Identifier or ProcessName
- fd lsapp 获取
- 如果获取不到,fd lsps 获取

#### -devi:
- default: usb
- -devi usb(usb devi)
- -devi u(usb devi)
- -devi local(local devi)
- -devi localhost(local devi)
- -devi ip:port(remote device)
- -devi 1234(devi id)


#### box 嵌入资源支持,用于cmodule支持
- 把文件放入box文件夹，使用 Box.String("filename") 或 Box.Uint8Array("filename")

#### download file支持(同步)
- send({"type":"download","path":"test/test.txt","append":true},new Uint8Array([0x01]).buffer)

#### download file支持(异步,以后会添加,包括进度条的支持)