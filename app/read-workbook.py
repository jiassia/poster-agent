# Copyright 2026 Poster Agent. Apache-2.0. Bounded OOXML reader, stdlib only.
import sys,json,zipfile,xml.etree.ElementTree as ET,posixpath
p=sys.argv[1]; ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(p) as z:
 infos=z.infolist()
 if len(infos)>5000 or sum(i.file_size for i in infos)>40*1024*1024: raise ValueError('Workbook exceeds import limits')
 def xml(name):
  b=z.read(name)
  if b'<!DOCTYPE' in b or b'<!ENTITY' in b:raise ValueError('XML entities forbidden')
  return ET.fromstring(b)
 strings=[]
 if 'xl/sharedStrings.xml' in z.namelist():
  strings=[''.join(si.itertext()) for si in xml('xl/sharedStrings.xml').findall('s:si',ns)]
 rels={r.attrib['Id']:r.attrib['Target'] for r in xml('xl/_rels/workbook.xml.rels')}
 sheets=[];total=0
 for sh in xml('xl/workbook.xml').find('s:sheets',ns):
  target=rels[sh.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
  name=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
  if not name.startswith('xl/'):raise ValueError('Invalid workbook path')
  cells=[]
  for cell in xml(name).findall('.//s:sheetData/s:row/s:c',ns):
   v=cell.find('s:v',ns);value=v.text if v is not None else None
   if cell.attrib.get('t')=='s' and value is not None:value=strings[int(value)]
   if cell.attrib.get('t')=='inlineStr':value=''.join(cell.find('s:is',ns).itertext())
   if value is not None:
    cells.append({'cell':cell.attrib['r'],'value':value,'formulaCached':cell.find('s:f',ns) is not None});total+=1
   if total>12000:raise ValueError('Too many workbook cells (max 12000)')
  sheets.append({'sheet':sh.attrib['name'],'cells':cells})
 print(json.dumps({'sheets':sheets,'notes':['原始单元格值；公式仅使用缓存结果，不执行公式；未自动推断日期/销量口径。']},ensure_ascii=False))
