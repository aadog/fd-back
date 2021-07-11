package main

import (
	"context"
	"errors"
	"fmt"
	frida_go "github.com/a97077088/frida-go"
	"github.com/gin-gonic/gin"
	jsoniter "github.com/json-iterator/go"
	"io/ioutil"
	"time"
)

type ApiParam struct {
	ApiType int
	JsPath string
	JsByte bool
	Name string
	Address string
	Path string
}

type Api struct {

}

func (l *Api) Run(param ApiParam) error {
	if param.Name==""{
		return errors.New("请先指定程序名称")
	}
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
	fmt.Printf("platform:%s 当前系统:%s(%s) 构架:%s 设备名称:%s 权限:%s \n",jssys.Get("platform").ToString(),jsos.Get(1).Get("id").ToString(),jsos.Get(0).Get("version").ToString(),jssys.Get("arch").ToString(),jssys.Get("name").ToString(),jssys.Get("access").ToString())
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
	var sc *frida_go.Script
	if param.JsByte{
		sc,err=session.CreateScriptFormBytes(fd,frida_go.ScriptOptions{})
		if err!=nil{
			return err
		}
	}else{
		sc,err=session.CreateScript(string(fd),frida_go.ScriptOptions{})
		if err!=nil{
			return err
		}
	}

	sc.OnMessage(sc.DefaultOnMessage)
	err=sc.Load()
	if err!=nil{
	    return err
	}
	defer sc.UnLoad()
	g:=gin.Default()
	g.POST(param.Path, func(c *gin.Context) {
		NewObjRender(c).JSON(func() (interface{}, error) {
			if sc.IsDestroyed(){
				return nil,errors.New("script is IsDestroyed")
			}
			req:= struct {
				Timeout string`json:"timeout"`
				Func string `json:"func"`
				Args []interface{} `json:"args"`
			}{}
			err = c.BindJSON(&req)
			if err != nil {
				return nil,err
			}
			timeout:=time.Second*30
			if req.Timeout!="" {
				timeout, err= time.ParseDuration(req.Timeout)
				if err != nil {
					return nil, err
				}
			}
			ctx,_:=context.WithTimeout(context.TODO(),timeout)
			jsr,err:=sc.RpcCall(ctx,req.Func,req.Args...)
			if err!=nil{
			    return nil,err
			}
			return jsr.GetInterface(),nil
		})
	})
	g.Run(param.Address)
	return nil
}

func NewApi()*Api{
	return &Api{}
}

