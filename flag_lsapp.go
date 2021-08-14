package main

import (
	"errors"
	"flag"
	"fmt"
	"github.com/a97077088/frida-go"
	jsoniter "github.com/json-iterator/go"
)
var param_lsapp_devi= FlagLsApp.String("devi","","设备")
var FlagLsApp =flag.NewFlagSet("lsapp",flag.ExitOnError)
func init(){
	FlagLsApp.Usage= func() {
		fmt.Fprintf(FlagLsApp.Output(), "============== 列出所有application 使用方法:%s\n", "lsapp")
		FlagLsApp.PrintDefaults()
	}
}

func FlagLsAppMain(args []string)error{
	FlagLsApp.Parse(args)
	if FlagLsApp.Parsed(){
		return NewLsApp().Run(LsAppParam{Devi: *param_lsapp_devi})
	}
	return errors.New("lsapp命令解析失败")
}

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
