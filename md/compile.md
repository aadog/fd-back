![](../gif/compile.webp)

#### compile(显示进程列表) 使用方法:
````
compile 1.js -devi string -name string
````

#### name
- ios is app icon label
- android is app icon label
- fd lsapp 获取
- 如果获取不到,fd lsps 获取

#### devi:
- default: usb
- -devi usb(usb devi)
- -devi u(usb devi)
- -devi local(local devi)
- -devi localhost(local devi)
- -devi ip:port(remote device)
- -devi 1234(devi id)