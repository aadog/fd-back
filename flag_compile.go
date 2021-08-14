package main

import (
	"errors"
	"flag"
	"fmt"
	frida_go "github.com/a97077088/frida-go"
	jsoniter "github.com/json-iterator/go"
	"io/ioutil"
	"os"
	"path"
	"strings"
)
var param_compile_name=FlagCompile.String("name","","app屏幕上看到的名字,比如 通讯录,(lsps的结果中可以看到)")
var param_compile_devi=FlagCompile.String("devi","","设备")
var FlagCompile =flag.NewFlagSet("compile",flag.ExitOnError)
func init(){
	FlagCompile.Usage= func() {
		fmt.Fprintf(FlagCompile.Output(), "============== 脚本编译 使用方法:%s\n", "compile 1.js -name 通讯录")
		FlagCompile.PrintDefaults()
	}
}

func FlagCompileMain(args []string)error{
	if len(args)<1{
		fmt.Println("解析js文件失败")
		FlagCompile.Usage()
		return nil
	}
	a1:=args[0]
	param_jspath:=a1
	FlagCompile.Parse(args[1:])
	if *param_compile_name==""{
		fmt.Println("name参数解析失败")
		FlagCompile.Usage()
		return nil
	}


	if FlagCompile.Parsed() {
		return NewCompile().Run(CompileParam{JsPath: param_jspath,Name:*param_compile_name,Devi: *param_compile_devi})
	}
	return errors.New("compile命令解析失败")
}

type CompileParam struct {
	Name string
	JsPath string
	Devi string
}
type Compile struct {

}

func (l *Compile) Run(param CompileParam) error {
	mgr:=frida_go.DeviceManager_Create()
	defer mgr.Close()
	d,err:=ParseDevice(mgr,param.Devi)
	if err!=nil{
		return err
	}
	sysparam,err:=d.QuerySystemParameters()
	if err!=nil{
		return err
	}
	jssys:=jsoniter.Wrap(sysparam)
	jsos:=jssys.Get("os")
	fmt.Printf("内核平台:%s cpu构架:%s 当前系统:%s(%s)  设备名称:%s 权限:%s \n",jssys.Get("platform").ToString(),jssys.Get("arch").ToString(),jsos.Get(1).Get("id").ToString(),jsos.Get(0).Get("version").ToString(),jssys.Get("name").ToString(),jssys.Get("access").ToString())
	p,err:=d.GetProcessByName(param.Name,frida_go.ProcessMatchOptions{})
	if err!=nil{
		return err
	}
	fmt.Println(p.Description())
	session,err:=d.Attach(p.Pid(),frida_go.SessionOptions{})
	if err!=nil{
		return err
	}
	defer session.Detach()
	fd,err:=ioutil.ReadFile(param.JsPath)
	if err!=nil{
		return err
	}
	bt,err:=session.CompileScript(string(fd),frida_go.ScriptOptions{})
	if err!=nil{
	    return err
	}
	pname:=strings.ReplaceAll(param.JsPath,path.Ext(param.JsPath),"")
	outname:=fmt.Sprintf("%s.compile%s",pname,path.Ext(param.JsPath))
	err=ioutil.WriteFile(outname,bt,os.ModePerm)
	if err!=nil{
	    return err
	}
	fmt.Println("编译完成:",outname)
	return nil
}

func NewCompile()*Compile{
	return &Compile{}
}
