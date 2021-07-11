package main

import (
	"fmt"
	"github.com/gin-gonic/gin"
	ginrender "github.com/gin-gonic/gin/render"
	"github.com/unrolled/render"
	"html/template"
	"io"
	"net/http"
	"strings"
)

//Render struct init
type Render struct {
	ginfuncmap template.FuncMap
	ops *render.Options
	rd *render.Render
}

func InstallGin(g *gin.Engine){

}

//TemplatePath html files path
func InstallHtmlRender(g *gin.Engine,options render.Options){
	ginfuncmap:=g.FuncMap
	options.Funcs=[]template.FuncMap{ginfuncmap}
	options.IsDevelopment= gin.Mode()==gin.DebugMode
	options.RequirePartials=true
	r:=&Render{
		rd:render.New(options),
	}
	g.HTMLRender=r
}
//Instance init
func (p *Render) Instance(name string, data interface{}) ginrender.Render {
	htmlops:=make([]render.HTMLOptions,0)
	sp:=strings.Split(name,"=>")
	if len(sp)>1{
		l:=len(sp)-1
		for i := 0; i <l; i++ {
			it:=sp[i]
			htmlops=append(htmlops,render.HTMLOptions{
				Layout: it,
				Funcs: p.ginfuncmap,
			})
		}
		name=sp[l]
	}
	return &RenderHTML{
		HtmlOptions: htmlops,
		RenderFn: p.rd.HTML,
		ops: p.ops,
		Name:     name,
		Data:     data,
	}
}

//RenderHTML strcut
type RenderHTML struct {
	ops *render.Options
	RenderFn func(w io.Writer, status int, name string, binding interface{}, htmlOpt ...render.HTMLOptions) error
	Status int
	Name     string
	Data interface{}
	HtmlOptions []render.HTMLOptions
}

//Render for gin interface  render override
func (p *RenderHTML) Render(w http.ResponseWriter) error {
	return p.RenderFn(w,p.Status,p.Name,p.Data,p.HtmlOptions...)
}

//WriteContentType  for gin interface  WriteContentType override
func (p *RenderHTML) WriteContentType(w http.ResponseWriter) {
	header := w.Header()
	if val := header["Content-Type"]; len(val) == 0 {
		header["Content-Type"] = []string{fmt.Sprintf("%s; charset=%s",p.ops.HTMLContentType,p.ops.Charset)}
	}
}
