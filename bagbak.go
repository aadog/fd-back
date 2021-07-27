package main

import (
	"code.cloudfoundry.org/bytefmt"
	"context"
	_ "embed"
	"errors"
	"fmt"
	frida_go "github.com/a97077088/frida-go"
	jsoniter "github.com/json-iterator/go"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

type BagBakMemcpyInfo struct{
	Bytes []byte
}
type BagBakDownloadInfo struct {
	Mode int
	F *os.File
	Size int
	FileName string
}


type BagBakParam struct {
	App string
	Devi string
}
type BagBak struct {

}

func (b *BagBak) ParseFilePath(fpath string)string{
	re :=regexp.MustCompile(`/var/containers/Bundle/Application/.*?/(.*?.app/.*?)`)
	fname:=re.ReplaceAllString(fpath,"$1")
	return fname
}
func (b *BagBak) ack(sc *frida_go.Script) {
	sc.Post(map[string]interface{}{"type":"ack"},nil)
}
func (l *BagBak) Run(param BagBakParam) error {
	mgr:=frida_go.DeviceManager_Create()
	defer mgr.Close()
	d,err:=ParseDevice(mgr,param.Devi)
	if err!=nil{
		return err
	}
	as,err:=d.EnumerateApplications(frida_go.ApplicationQueryOptions{})
	if err!=nil{
		return err
	}
	var execapp *frida_go.ApplicationDetails
	for _, app := range as {
		if app.Name()==param.App{
			execapp=app
		}
	}
	if param.App==""||execapp==nil{
		fmt.Println("app list:")
		for _, app := range as {
			fmt.Println(app.Description())
		}
	}
	if param.App==""{
		return errors.New("没有指定要dump得app名称")
	}
	if execapp==nil{
		return errors.New(fmt.Sprintf("获取app失败:%s",param.App))
	}
	sysparam,err:=d.QuerySystemParameters()
	if err!=nil{
		return err
	}
	jssys:=jsoniter.Wrap(sysparam)
	jsos:=jssys.Get("os")
	fmt.Printf("内核平台:%s cpu构架:%s 当前系统:%s(%s)  设备名称:%s 权限:%s \n",jssys.Get("platform").ToString(),jssys.Get("arch").ToString(),jsos.Get(1).Get("id").ToString(),jsos.Get(0).Get("version").ToString(),jssys.Get("name").ToString(),jssys.Get("access").ToString())

	p,err:=d.GetProcessByName(param.App,frida_go.ProcessMatchOptions{})
	if err!=nil{
		return err
	}

	session,err:=d.Attach(p.Pid(),frida_go.SessionOptions{})
	if err!=nil{
		return err
	}
	defer session.Detach()

	fd,err:=scripts.ReadFile("scripts/bagbak/agent.js")
	if err!=nil{
		return err
	}
	source,err:=scripts.ReadFile("scripts/bagbak/source.c")
	if err!=nil{
	    return err
	}

	fd=append(fd,[]byte("\r\nconsole.log(\"dump start\")")...)
	sc,err:=session.CreateScript(string(fd),frida_go.ScriptOptions{})
	if err!=nil{
	    return err
	}
	ctx,cancel:=context.WithCancel(context.TODO())
	sc.OnDestroyed(func() {
		cancel()
	})

	hslk:=sync.Map{}
	memcpylk:=sync.Map{}
	sc.OnMessage(func(sjson jsoniter.Any, data []byte) {
		tp:=sjson.Get("type").ToString()
		if tp=="log"{
			log.Println(sjson.Get("payload").ToString())
		}else if tp=="error"{
			cancel()
			log.Println(sjson.Get("stack").ToString())
			log.Println(sjson.Get("fileName").ToString())
		}else if tp=="send"{
			sendtype:=sjson.Get("payload","type").ToString()
			subject:=sjson.Get("payload","subject").ToString()
			if sendtype=="download" || sendtype=="down" || sendtype=="downloadfile"{
				fpath:=sjson.Get("payload","path").ToString()
				if fpath==""{
					fpath=sjson.Get("payload","path").ToString()
				}
				appendfile:=sjson.Get("payload","append").ToBool()
				if fpath==""{
					log.Println(sjson.ToString())
					return
				}
				iflk,_:=hslk.LoadOrStore(fpath,sync.Mutex{})
				flk:=iflk.(sync.Mutex)
				flk.Lock()
				defer flk.Unlock()
				toroot:=fmt.Sprintf("./download")
				sdir,sfilename:=filepath.Split(fpath)
				todir:=filepath.Join(toroot,sdir)
				err=os.MkdirAll(todir,os.ModePerm)
				if err!=nil{
					log.Println(err.Error())
					return
				}

				fg:=os.O_CREATE
				if appendfile==true{
					fg|=os.O_APPEND
				}
				f,err:=os.OpenFile(filepath.Join(todir,sfilename),fg,os.ModePerm)
				if err!=nil{
					log.Println(err.Error())
					return
				}
				defer f.Close()
				_,err=f.Write(data)
				if err!=nil{
					log.Println(err.Error())
					return
				}
			}else if subject=="download"{
				event:=sjson.Get("payload","event").ToString()
				session:=sjson.Get("payload","session").ToString()
				stat:=sjson.Get("payload","stat")

				if event=="begin"{
					size:=stat.Get("size").ToInt()
					filename:=l.ParseFilePath(sjson.Get("payload","filename").ToString())
					fmt.Printf("正在脱壳:%s 大小:%s\n",filename,bytefmt.ByteSize(uint64(size)))
					err:=os.MkdirAll(fmt.Sprintf("%s",filepath.Dir(filename)), os.FileMode(stat.Get("mode").ToInt()))
					if err!=nil{
					    panic(err)
					}
					f,err:=os.OpenFile(filename,os.O_CREATE,os.FileMode(stat.Get("mode").ToInt()))
					if err!=nil{
					    panic(err)
					}
					hslk.Store(session,BagBakDownloadInfo{
						F: f,
						Size: size,
						FileName: filename,
						Mode: stat.Get("mode").ToInt(),
					})
					l.ack(sc)
				}else if event=="end"{
					f,ok:=hslk.LoadAndDelete(session)
					if ok{
						f.(BagBakDownloadInfo).F.Close()
					}
					l.ack(sc)
				}else if event=="data"{
					f,ok:=hslk.Load(session)
					if ok{
						f.(BagBakDownloadInfo).F.Write(data)
					}
					l.ack(sc)
				}
			}else if subject=="memcpy"{
				event:=sjson.Get("payload","event").ToString()
				session:=sjson.Get("payload","session").ToString()
				if event=="begin"{
					memcpylk.Store(session,BagBakMemcpyInfo{
						Bytes: make([]byte,sjson.Get("payload","size").ToInt()),
					})
					l.ack(sc)
				}else if event=="data"{
					f,ok:=memcpylk.Load(session)
					if ok{
						for i := 0; i < len(data); i++ {
							f.(BagBakMemcpyInfo).Bytes[i]=data[i]
						}
					}
					l.ack(sc)
				}else if event=="end"{
					//_,ok:=memcpylk.LoadAndDelete(session)
					//if ok{
					//}
					l.ack(sc)
				}
			}else if subject=="patch"{
				offset:=sjson.Get("payload","offset").ToInt64()
				size:=sjson.Get("payload","size").ToInt64()
				blob:=sjson.Get("payload","blob").ToString()
				filename:=l.ParseFilePath(sjson.Get("payload","filename").ToString())

				if blob!=""{
					b,ok:=memcpylk.Load(blob)
					if ok{
						f,err:=os.OpenFile(filename,os.O_WRONLY,os.ModePerm)
						if err!=nil{
						    panic(err)
						}
						defer f.Close()
						_,err=f.Seek(offset,io.SeekStart)
						if err!=nil{
						    panic(err)
						}
						_,err=f.Write(b.(BagBakMemcpyInfo).Bytes)
						if err!=nil{
							panic(err)
						}
					}
				}else if size>0{
					f,err:=os.OpenFile(filename,os.O_WRONLY,os.ModePerm)
					if err!=nil{
						panic(err)
					}
					defer f.Close()
					_,err=f.Seek(offset,io.SeekStart)
					if err!=nil{
						panic(err)
					}
					_,err=f.Write(make([]byte,size))
					if err!=nil{
						panic(err)
					}
				}else{
					log.Println(sjson.ToString())
				}
			}else {
				log.Println(sjson.ToString())
			}
		}else{
			log.Println(sjson.ToString())
		}
	})
	err=sc.Load()
	if err!=nil{
		return err
	}
	defer sc.UnLoad()


	preparer,err:=sc.RpcCall(context.TODO(),"prepare",string(source))
	if err!=nil{
	    return err
	}
	log.Println("preparer:",preparer.ToString())
	dumpr,err:=sc.RpcCall(context.TODO(),"dump",map[string]interface{}{"executableOnly":false})
	if err!=nil{
		return err
	}
	if dumpr.ToInt()==0{
		log.Println("dump执行完毕")
	}
	cancel()
	<-ctx.Done()
	fmt.Println("脚本运行完毕")
	return nil
}

func NewBagBak() *BagBak {
	return &BagBak{}
}
