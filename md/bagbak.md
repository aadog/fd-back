![](../gif/bagbak.webp)

#### bagbak(ipa脱壳) 使用方法:

##### pid优先级大于名称

#### 输入applabel或者identifier 他自动会搜索

#### fd 只会以附加模式工作,使用前确认app是否在手机上打开

````
bakbag applabel -devi string

example:

1. fd bagbak 通讯录

2. fd bagbak -pid 907

3. fd bagbak -pid 907 -devi local

````

#### applabel or identifier:
- ios is app icon label,macos use pid
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

#### -pid
- 要脱壳的 process id 
- pid模式应该支持macos
- pid模式应该支持系统库，比如webkit
