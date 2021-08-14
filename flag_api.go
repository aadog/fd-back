package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	frida_go "github.com/a97077088/frida-go"
	"github.com/gin-gonic/gin"
	jsoniter "github.com/json-iterator/go"
	"io/ioutil"
	"time"
)


var FlagApi =flag.NewFlagSet("api",flag.ExitOnError)

var param_api_http=FlagApi.Bool("http",true,"导出http接口")
var param_api_grpc=FlagApi.Bool("grpc",false,"导出grpc接口(暂时还不支持)")
var param_api_jsbyte=FlagApi.Bool("jsbyte",false,"是否使用编译过的js 字节码")
var param_api_name=FlagApi.String("name","","app屏幕上看到的名字,比如 通讯录,(lsps的结果中可以看到)")
var param_api_address=FlagApi.String("address",":8080","接口监听地址")
var param_api_path=FlagApi.String("path","/call","api监听路径")
var param_api_devi=FlagApi.String("devi","","设备")

func init(){
	FlagApi.Usage= func() {
		fmt.Fprintf(FlagApi.Output(), "============== api导出 使用方法:%s\n", "api 1.js -name 通讯录")
		FlagApi.PrintDefaults()
	}
}

func FlagApiMain(args []string)error{
	if len(args)<1{
		fmt.Println("解析js文件失败")
		FlagApi.Usage()
		return nil
	}
	api_jspath:=args[0]
	FlagApi.Parse(args[1:])
	if *param_api_name==""{
		fmt.Println("name参数解析失败")
		FlagApi.Usage()
		return nil
	}

	if FlagApi.Parsed(){

		kd:=0
		if *param_api_http{
			kd=0
		}
		if *param_api_grpc{
			kd=1
		}

		return NewApi().Run(ApiParam{ApiType: kd,JsPath: api_jspath,JsByte: *param_api_jsbyte,Name:*param_api_name,Address: *param_api_address,Path: *param_api_path,Devi: *param_api_devi})
	}
	return errors.New("api命令解析失败")
}

type ApiParam struct {
	ApiType int
	JsPath string
	JsByte bool
	Name string
	Address string
	Path string
	Devi string
}

type Api struct {

}

func (l *Api) Run(param ApiParam) error {
	if param.Name==""{
		return errors.New("请先指定程序名称")
	}
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

