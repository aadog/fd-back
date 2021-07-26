package main

import (
	"fmt"
	frida_go "github.com/a97077088/frida-go"
	jsoniter "github.com/json-iterator/go"
	"io/ioutil"
	"os"
	"path"
	"strings"
)

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
