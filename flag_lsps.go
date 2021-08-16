package main

import (
	"errors"
	"flag"
	"fmt"
	frida_go "github.com/a97077088/frida-go"
	jsoniter "github.com/json-iterator/go"
)

var param_lsps_devi= FlagLsPs.String("devi","","设备")
var FlagLsPs =flag.NewFlagSet("lsps",flag.ExitOnError)
func init(){
	FlagLsPs.Usage= func() {
		fmt.Fprintf(FlagLsPs.Output(), "============== 列出所有进程 使用方法:%s\n", "lsps")
		FlagLsPs.PrintDefaults()
	}
}

func FlagLsPsMain(args []string)error{

	FlagLsPs.Parse(args)
	if FlagLsPs.Parsed() {
		return NewLsPs().Run(LsPsParam{*param_lsps_devi})
	}
	return errors.New("lsps命令解析失败")
}

type LsPsParam struct {
	Devi string
}
type LsPs struct {

}

func (l *LsPs) Run(param LsPsParam) error {
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
