package main

import (
	"fmt"
	"fd/jsonresult"
	"github.com/gin-gonic/gin"
)

func NewEmtryObjRender(options ...Option) *ObjRender {
	or := &ObjRender{
		ErrorTemplate: "500",
		Status:        200,
		StatusError:   500,
	}
	for _, option := range options {
		option(or)
	}
	return or
}
func NewObjRender(ctx *gin.Context, options ...Option) *ObjRender {
	or := &ObjRender{
		ErrorTemplate: "500",
		Status:        200,
		StatusError:   200,
		c:             ctx,
	}
	for _, option := range options {
		option(or)
	}
	return or
}
func OpLayout(layout string) Option {
	return func(f *ObjRender) {
		f.Layout = layout
	}
}
func OpErrorTemplate(template string) Option {
	return func(f *ObjRender) {
		f.ErrorTemplate = template
	}
}
func OpTemplate(template string) Option {
	return func(f *ObjRender) {
		f.Template = template
	}
}
func OpStataUsError(status int) Option {
	return func(f *ObjRender) {
		f.StatusError = status
	}
}
func OpStatus(status int) Option {
	return func(f *ObjRender) {
		f.Status = status
	}
}
func OpErrorFunc(errfn func(f *ObjRender, err error)) Option {
	return func(f *ObjRender) {
		f.ErrorFunc = errfn
	}
}

type Option func(f *ObjRender)
type ObjRender struct {
	c             *gin.Context
	Layout        string
	ErrorTemplate string
	Template      string
	StatusError   int
	Status        int
	ErrorFunc     func(f *ObjRender, err error)
}
func (f *ObjRender) CtxHTMLError(c *gin.Context, err error) {
	cf := f.Clone()
	cf.SetCtx(c)
	cf.HTMLError(err)
}
func (f *ObjRender) CtxHTML(c *gin.Context, fn func() (interface{}, error)) {
	cf := f.Clone()
	cf.SetCtx(c)
	cf.HTML(fn)
}
func (f *ObjRender) CtxJSONError(c *gin.Context, err error) {
	cf := f.Clone()
	cf.SetCtx(c)
	cf.JSONError(err)
}
func (f *ObjRender) CtxJSON(c *gin.Context, fn func() (interface{}, error)) {
	cf := f.Clone()
	cf.SetCtx(c)
	cf.JSON(fn)
}
func (f *ObjRender) Clone() *ObjRender {
	return &ObjRender{
		c:             f.c,
		Layout:        f.Layout,
		ErrorTemplate: f.ErrorTemplate,
		Template:      f.Template,
		StatusError:   f.Status,
		Status:        f.Status,
		ErrorFunc:     f.ErrorFunc,
	}
}
func (f *ObjRender) SetCtx(ctx *gin.Context) *ObjRender {
	f.c = ctx
	return f
}
func (f *ObjRender) SetOption(option Option) *ObjRender {
	option(f)
	return f
}
func (f *ObjRender) HTMLError(err error) {
	if f.Layout != "" {
		f.Template = fmt.Sprintf("%s=>%s", f.Layout, f.Template)
	}
	if f.ErrorFunc != nil {
		f.ErrorFunc(f, err)
		return
	}
	f.c.HTML(f.StatusError, f.ErrorTemplate, err)
	return
}
func (f *ObjRender) HTML(fn func() (interface{}, error)) {
	if f.Template == "" {
		f.c.HTML(f.StatusError, f.ErrorTemplate, "需要使用OpTemplate指定模板")
		return
	}
	if f.Layout != "" {
		f.Template = fmt.Sprintf("%s=>%s", f.Layout, f.Template)
	}
	if fn == nil {
		f.c.HTML(f.Status, f.Template, nil)
		return
	}
	r, err := fn()
	if err != nil {
		if f.ErrorFunc != nil {
			f.ErrorFunc(f, err)
			return
		}
		f.c.HTML(f.StatusError, f.ErrorTemplate, err)
		return
	}
	f.c.HTML(f.Status, f.Template, r)
}
func (f *ObjRender) JSONError(err error) {
	if f.ErrorFunc != nil {
		f.ErrorFunc(f, err)
		return
	}
	f.c.JSON(f.StatusError, jsonresult.NewSimpleError(err, nil))
}
func (f *ObjRender) JSON(fn func() (interface{}, error)) {
	if fn == nil {
		f.c.JSON(f.Status, jsonresult.NewSimpleResult(nil))
		return
	}
	r, err := fn()
	if err != nil {
		if f.ErrorFunc != nil {
			f.ErrorFunc(f, err)
			return
		}
		f.c.JSON(f.StatusError, jsonresult.NewSimpleError(err, nil))
		return
	}
	f.c.JSON(f.Status, jsonresult.NewSimpleResult(r))
}
