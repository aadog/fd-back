package main

import (
	"fmt"
	frida_go "github.com/a97077088/frida-go"
	jsoniter "github.com/json-iterator/go"
)

type LsPs struct {

}

func (l *LsPs) Run() error {
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
	pss,err:=d.EnumerateProcesses(frida_go.ProcessQueryOptions{})
	if err!=nil{
		return err
	}
	for _, ps := range pss {
		fmt.Printf("名称:%-50s pid:%d \n",ps.Name(),ps.Pid())
	}

	return nil
}

func NewLsPs()*LsPs{
	return &LsPs{}
}
