package main

import (
	"fmt"
	"github.com/a97077088/frida-go"
	jsoniter "github.com/json-iterator/go"
)
type LsAppParam struct {
	Devi string
	Dir string
}
type LsApp struct {

}

func (l *LsApp) Run(param LsAppParam) error {
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
	apps,err:=d.EnumerateApplications(frida_go.ApplicationQueryOptions{})
	if err!=nil{
	    return err
	}
	for _, app := range apps {
		pid:=app.Pid()
		if pid!=0{
			fmt.Printf("名称:%-15s identifier:%-30s pid:%d\n",app.Name(),app.Identifier(),app.Pid())
		}else{
			fmt.Printf("名称:%-15s identifier:%-30s\n",app.Name(),app.Identifier())
		}
	}

	return nil
}

func NewLsApp()*LsApp{
	return &LsApp{}
}
