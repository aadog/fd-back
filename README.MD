## fd windows,linux下frida的调试工具 (单 exe,不需要python和nodejs)

#### 现在他只支持USB

[english click here](./EREADME.MD)

#### [预编译的二进制文件在这里下载](https://github.com/a97077088/fd/releases)


#### 支持列表:

- 创建一个基于 frida-agent-example的typescript工程(拥有完美的智能提示)
- 使用webstorm进行调试，就像在开发一样,运行,暂停,打印消息
- 编译脚本为byte code(可以加速,或者加密?)
- 显示所有app列表
- 显示所有进程列表
- 一键导出api为http或者grpc接口来调用

### 创建frida工程

### create frida-agent-example
```
cd ~/src
fd create myfrida
cd myfrida
npm install
fd run _agent.js -name 通讯录
```

![](gif/create.gif)

### 运行js到设备

### run _agent.js -name 通讯录

##### * 支持下载文件功能,例如: 

````
send({"type":"download","path":"test/test.txt","append":true},new Uint8Array([0x01]).buffer);
````

##### 支持本地资源访问: 把资源放入:agent/box文件夹,可以使用以下代码访问:
````
import {Box} from "./box";
Box.String("1.txt")
Box.Uint8Array("1.txt")
````

```
cd ~/src
fd create myfrida
cd myfrida
npm install
webstorm run _agent.js
Run/Debug Configurations 
1.replace Node interpreter to fd
2.set Node parameters "run"
3.set Application parameters "-name 通讯录"
4.Now it's working properly
```

### run (webstorm debug,It's like development engineering)

![](gif/run.gif

下载文件例子:
```
send({"type":"download","filename":"dd","append":true},new Uint8Array([0x01]).buffer)
```

```
cd ~/src
fd create myfrida
cd myfrida
npm install
fd run _agent.js -name 通讯录
```

### 编译脚本到byte

### compile _agent.js -name 通讯录

![](gif/compile.gif)

```
cd ~/src
fd create myfrida
cd myfrida
npm install
fd compile _agent.js -name 通讯录
New file _agent.compile.js appears in the current directory
```

### 列出所有设备上的application

### lsapp

```
fd lsapp
All applications are now listed
```

### 列出设备上所有ps

### lsps

```
fd lsapp
All process are now listed
```

### 导出api到http或grpc

### api (export api to http/grpc)

```
fd api api.js -name 通讯录 -address :8080
Now you can call the API in a format like the following


POST /call HTTP/1.1
Host: localhost:8081
User-Agent: Charles/4.6.1
Content-Type: text/json
Content-Length: 63

{
    "func":"add",
    "args":[1,2],
    "timeout":"30s"
}
ret:
{
	"code": 0,
	"msg": "操作成功",
	"data": 3
}
```


### 运行帮助

```
fd --help

============== 创建工程 使用方法:create pdir

============== 脚本调试 使用方法:run 1.js -name 通讯录
-jsbyte
是否使用编译过的js 字节码
-name string
调试进程名称,比如 通讯录,(lsps的结果中可以看到)

============== 脚本编译 使用方法:compile 1.js -name 通讯录
-name string
app屏幕上看到的名字,比如 通讯录,(lsps的结果中可以看到)

============== 列出所有application 使用方法:lsapp

============== 列出所有进程 使用方法:lsps

============== api导出 使用方法:api 1.js -name 通讯录
-address string
接口监听地址 (default ":8080")
-grpc
导出grpc接口(暂时还不支持)
-http
导出http接口 (default true)
-jsbyte
是否使用编译过的js 字节码
-name string
app屏幕上看到的名字,比如 通讯录,(lsps的结果中可以看到)
-path string
api监听路径 (default "/call")
```