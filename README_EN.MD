## fd   

#### 简要介绍
* **[中文文档点击这里](README.MD)**
* **frida 运行时(不需要python,只有单一个文件)**
* **fd 使用fd前请确认手机上有frida-server**
* **优雅的使用webstorm开发(拥有智能完美的智能提示,内置了一些调试库) **

#### a brief introdction
* **frida runtime (no python required, only a single file)**
* **fd need you phone require frida-server**
* **Elegant use of webstorm development (with smart and perfect smart tips, some built-in debugging libraries) **
* ** ** *


![](md/gif/run.webp)

#### [Precompiled binaries can be downloaded here](https://github.com/a97077088/fd/releases)

![](md/gif/bagbak.webp)

#### what's frida:
- **The world's top full platform reverse dynamic debugging framework**
- **Use JavaScript scripts to dynamically hook and trace native instructions**
- **Detailed document: https://frida.re/**


#### what's fd:
- **Frida runtime for single file(client),He doesn't need Python and nodejs support,Development using golang(no cgo)**
- **It is mainly used as Frida runtime, such as exporting API**
- **fd support Remote host, specify the - H function in Devi and Frida,View documents in detail[Read graphic tutorial](md/bagbak.md)**
- **fd Built in IOS dump tool bagpak,View documents in detail[Read graphic tutorial](md/bagbak.md)**
- **fd Support direct development in webstorm,It's like program development，View documents in detail[Read graphic tutorial](md/run.md)**
- **fd Support api One click export HTTP interface View documents in detail[Read graphic tutorial](md/api.md)**

#### Start using
- #### ios dump:
````
1. open Cydia 
2. add repository: https://build.frida.re
3. search: frida and install
4. Download according to the system fd,(windows or linux or macos?): https://github.com/a97077088/fd/releases
5. Data cable link to computer
6. shell (The address book needs to be opened manually and placed in the front desk):fd bagbak 通讯录
7. or: fd bagbak com.apple.MobileAddressBook
//dump file:Contacts.app Now it appears in your directory
````

- #### android view apps:
````
1. open Magisk 
2. search: MagiskFrida
3. Download according to the system fd,(windows or linux or macos?): https://github.com/a97077088/fd/releases
4. Data cable link to computer
5. shell: fd lsapp
//app list Now it appears in your directory
````

- #### Show all local processes:
````
1. Download according to the system fd,(windows or linux or macos?): https://github.com/a97077088/fd/releases
2. Data cable link to computer
3. shell: fd lsps -devi=local
//ps list Now it appears in your directory
````



- #### use webstorm development:
````
1. Download according to the system fd,(windows or linux or macos?): https://github.com/a97077088/fd/releases
2. shell: fd create testproject
3. shell: cd myfrida
4. shell: npm install
5.open webstorm click:Run/Debug Configurations 
    1.set Node interpreter is fd
    2.set Node parameters "run"
    3.set Application parameters "-name 通讯录"
6.click run button in webstorm 
//Now it's as easy to debug as developing applications
````

#### fd Specific functions
- **fd ios dump tool(fd bagbak) [Read graphic tutorial](md/bagbak.md)** **ipa dump,Integrated bagpak plug-in,Support the shelling of extended files. It does not need SSH  [ChiChou/bagbak](https://github.com/ChiChou/bagbak)**
- **fd Create a project based on frida-agent-example template(fd create) [Read graphic tutorial](md/create.md)** **Create based on tyescripts frida-agent-example project,With perfect intelligent tips [oleavr/frida-agent-example](https://github.com/oleavr/frida-agent-example)**
- **fd export api(fd api) [Read graphic tutorial](md/api.md)** **Easily export exports to HTTP or grpc interface calls**
- **fd view apps(fd lsapp) [Read graphic tutorial](md/lsapp.md)** **Show list of all apps**
- **fd view processs(fd lsps) [Read graphic tutorial](md/lsps.md)** **Displays a list of all processes**
- **fd view devices(fd lsdev) [Read graphic tutorial](md/lsdev.md)** **Display device list**
- **fd compile script to byte(fd compile) [Read graphic tutorial](md/compile.md)** **Compile script as byte code**
- **fd run js(fd run) [Read graphic tutorial](md/run.md)** **integrate webstorm,Use Frida debugging just like development engineering,Intelligent prompt, error report, etc**

#### fd What frameworks are used:
- **The core foundation part is based on frida The world's top full platform reverse dynamic debugging framework [Project View](https://frida.re/)**
- **The core part is based on frida-go It is a Frida core client with pure golang binding [a97077088/frida-go](https://github.com/a97077088/frida-go)**
- **Cross platform dynamic library from [ying32/dylib],It is compatible with dynamic libraries of three platforms(https://github.com/ying32/dylib)**
- **tempdll Technology extracted from [ying32/govcl],This is a powerful golang native UI library**
- **Developed using Google [Golang language](https://golang.org/)**



### Run help

```
fd --help

============== List all devices usage method:lsdev

============== Create project usage method:create pdir

============== Script debugging usage method:run 1.js -name 通讯录
  -devi string
        devi (id,or network address,or local or usb)
  -jsbyte
        Use compiled JS bytecode
  -name string
        Debugging process name, such as address book, (you can see it in LSPs results)
  -pid uint
        process pid

============== Script Compilation usage method:compile 1.js -name 通讯录
  -devi string
        devi (id,or network address,or local or usb)
  -name string
        The name seen on the app screen, such as the address book, (you can see it in the LSPs result)

============== list all application usage method:lsapp
  -devi string
        devi (id,or network address,or local or usb)

============== List all processes usage method:lsps
  -devi string
        devi (id,or network address,or local or usb)

============== api export usage method:api 1.js -name 通讯录
  -address string
        Interface listening address (default ":8080")
  -devi string
        devi (id,or network address,or local or usb)
  -grpc
        Export grpc interface (not supported yet)
  -http
        Export HTTP interface (default true)
  -jsbyte
        Use compiled JS bytecode
  -name string
        The name seen on the app screen, such as the address book, (you can see it in the LSPs result)
  -path string
        API listening path (default "/call")

============== bagbak(ipa dump) usage method:bakbag 通讯录
  -devi string
        devi (id,or network address,or local or usb)
  -pid uint
        Process ID
```