package main

import (
	"errors"
	"flag"
	"fmt"
	frida_go "github.com/a97077088/frida-go"
)



var FlagLsDev =flag.NewFlagSet("lsdev",flag.ExitOnError)
func init(){
	FlagLsDev.Usage= func() {
		fmt.Fprintf(FlagLsDev.Output(), "============== 列出所有设备 使用方法:%s\n", "lsdev")
		FlagLsDev.PrintDefaults()
	}
}

func FlagLsDevMain(args []string)error{
	FlagLsDev.Parse(args)
	if FlagLsDev.Parsed(){
		return NewLsDev().Run(LsDevParam{})
	}
	return errors.New("lsdev命令解析失败")
}



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
