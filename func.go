package main

import (
	"errors"
	frida_go "github.com/a97077088/frida-go"
	"net"
	"strings"
)


func GetName(d* frida_go.Device,name string)(*frida_go.ApplicationDetails,uint,error){
	apps,err:=d.EnumerateApplications(frida_go.ApplicationQueryOptions{})
	if err!=nil{
	    return nil,0,err
	}
	for _, app := range apps {
		if strings.ToLower(app.Name())==strings.ToLower(name)||(strings.ToLower(app.Identifier())==strings.ToLower(name)){
			return app, uint(app.Pid()),nil
		}
	}
	pss,err:=d.EnumerateProcesses(frida_go.ProcessQueryOptions{})
	if err!=nil{
	    return nil,0,err
	}
	for _, ps := range pss {
		if strings.ToLower(ps.Name())==strings.ToLower(name){
			return nil,ps.Pid(),nil
		}
	}
	return nil,0,errors.New("查找进程和application失败,确认是否有这个进程")
}


func ParseDevice(mgr* frida_go.DeviceManager,s string)(*frida_go.Device,error){
	s=strings.ToLower(s)
	if s==""||s=="usb"||s=="u"{
		return mgr.GetDeviceByType(frida_go.DeviceType_USB,1000)
	}
	if s=="local"||s=="localhost"||s=="Local System"||s=="Local Socket"{
		return mgr.GetDeviceByType(frida_go.DeviceType_LOCAL,1000)
	}
	var d *frida_go.Device
	_,_,err:=net.SplitHostPort(s)
	if err==nil{
		d,err=mgr.AddRemoteDevice(s,frida_go.RemoteDeviceOptions{
		})
		if err!=nil{
		    return nil,err
		}
	}else{
		d,err=mgr.FindDeviceById(s,1000)
		if err!=nil{
		    return nil,err
		}
	}

	_,err=d.EnumerateProcesses(frida_go.ProcessQueryOptions{})
	if err!=nil{
	    return nil,err
	}
	return d,err
}