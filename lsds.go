package main

import (
	"fmt"
	frida_go "github.com/a97077088/frida-go"
)

type LsDevParam struct {

}
type LsDev struct {

}

func (l *LsDev) Run(param LsDevParam) error {
	mgr:=frida_go.DeviceManager_Create()
	defer mgr.Close()
	ds,err:=mgr.EnumerateDevices()
	if err!=nil{
	    panic(err)
	}
	for _, d := range ds {
		dtype:=d.Type()
		tp:="未知"
		if dtype==0{
			tp="本地"
		}else if dtype==1{
			tp="远程"
		}else if dtype==2{
			tp="usb"
		}
		fmt.Println(fmt.Sprintf("设备id:%s ,名称: %s 类型:%s",d.Id(),d.Name(),tp))
	}
	return nil
}

func NewLsDev()*LsDev{
	return &LsDev{}
}
