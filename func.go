package main

import (
	frida_go "github.com/a97077088/frida-go"
	"strings"
)

func ParseDevice(mgr* frida_go.DeviceManager,s string)(*frida_go.Device,error){
	s=strings.ToLower(s)
	if s==""||s=="usb"||s=="u"{
		return mgr.GetDeviceByType(frida_go.DeviceType_USB,1000)
	}
	if s=="local"||s=="localhost"{
		return mgr.GetDeviceByType(frida_go.DeviceType_LOCAL,1000)
	}
	d,err:=mgr.AddRemoteDevice(s,frida_go.RemoteDeviceOptions{
	})
	_,err=d.EnumerateProcesses(frida_go.ProcessQueryOptions{})
	if err!=nil{
	    return nil,err
	}
	return d,err
}