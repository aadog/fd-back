package main

import (
	"context"
	"fmt"
	frida_go "github.com/a97077088/frida-go"
	jsoniter "github.com/json-iterator/go"
	"io/ioutil"
	"log"
)

type RunParam struct {
	Name string
	JsPath string
	JsByte bool
}
type Run struct {

}

func (l *Run) Run(param RunParam) error {
	mgr:=frida_go.DeviceManager_Create()
	defer mgr.Close()
	d,err:=mgr.GetDeviceByType(frida_go.DeviceType_USB,1000)
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
	fmt.Printf("调试进程:%s 进程id:%d 脚本:%s\n",p.Name(),p.Pid(),param.JsPath)
	session,err:=d.Attach(p.Pid(),frida_go.SessionOptions{})
	if err!=nil{
		return err
	}
	defer session.Detach()

	fd,err:=ioutil.ReadFile(param.JsPath)
	if err!=nil{
		return err
	}
	var sc *frida_go.Script
	if param.JsByte{
		sc,err=session.CreateScriptFormBytes(fd,frida_go.ScriptOptions{})
	}else{
		sc,err=session.CreateScript(string(fd),frida_go.ScriptOptions{})
	}
	if err!=nil{
		return err
	}
	ctx,cancel:=context.WithCancel(context.TODO())
	sc.OnDestroyed(func() {
		cancel()
	})
	sc.OnMessage(func(sjson jsoniter.Any, data []byte) {
		tp:=sjson.Get("type").ToString()
		if tp=="log"{
			log.Println(sjson.Get("payload").ToString())
		}else if tp=="error"{
			cancel()
			log.Println(sjson.Get("stack").ToString())
			log.Println(sjson.Get("fileName").ToString())
		}else{
			log.Println(sjson.ToString())
		}
	})
	err=sc.Load()
	if err!=nil{
	    return err
	}
	defer sc.UnLoad()


	<-ctx.Done()
	fmt.Println("脚本运行完毕")
	return nil
}

func NewRun()*Run{
	return &Run{}
}
