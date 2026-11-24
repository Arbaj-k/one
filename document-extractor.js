/* Dedicated browser-side document text -> structured JSON extractor.
 * Keeps page-level OCR/text verbatim so semantic parsing never discards source evidence.
 */
(function(global){
 'use strict';
 const normalizeKey=value=>String(value||'').toLowerCase().trim()
  .replace(/[^a-z0-9\u0900-\u097f]+/g,'_').replace(/^_+|_+$/g,'')||'field';
 function extract(name,text){
  const raw=String(text||'');
  const pages=raw.split(/(?=\[Page\s+\d+\])/i).map((part,index)=>{
   const match=part.match(/^\[Page\s+(\d+)\]/i),page=match?Number(match[1]):index+1;
   const lines=part.replace(/^\[Page\s+\d+\]\s*/i,'').split(/\n+/)
    .map(line=>line.replace(/\s+/g,' ').trim())
    .filter(line=>line&&!/^\[(?:OCR|No selectable text detected|No readable text found)[^\]]*\]$/i.test(line));
   return {page,text:lines};
  }).filter(item=>item.text.length);
  const facts=[];
  const labels=[
   {type:'expiry',re:/(?:expiry|expires?|expiration|validity|समाप्ति|समाप्त|वैधता|वैध\s*तक)/i},
   {type:'deadline',re:/(?:last\s*date|deadline|due\s*date|अंतिम\s*तिथि|आखिरी\s*तारीख|जमा\s*करने\s*की\s*अंतिम)/i},
   {type:'date',re:/(?:date|दिनांक|तिथि|तारीख)/i},
   {type:'amount',re:/(?:amount|fee|fees|total|price|राशि|शुल्क|फीस|कुल)/i},
   {type:'time',re:/(?:time|समय)/i},
   {type:'venue',re:/(?:venue|location|place|स्थान|जगह)/i}
  ];
  for(const page of pages)for(const line of page.text){
   const match=line.match(/^\s*([^:：|\t]{2,60})\s*[:：]\s*(.{1,220})\s*$/);
   if(!match)continue;
   const label=match[1].trim(),value=match[2].trim(),field=labels.find(item=>item.re.test(label));
   if(field)facts.push({type:field.type,page:page.page,label,value,source_line:line});
  }
  const key_value=[];
  for(const page of pages)for(const line of page.text){
   const m=line.match(/^\s*([^:：|\t]{2,50})\s*[:：]\s*(.+?)\s*$/);
   if(m)key_value.push({page:page.page,key:normalizeKey(m[1]),label:m[1].trim(),value:m[2].trim(),raw:line});
  }
  const tables=[];
  // Preserve blank cells: a timetable is a grid, and dropping an empty cell
  // shifts every later subject into the wrong time slot.
  const splitCells=line=>{
   const delimiter=line.includes('|')?'|':line.includes('\t')?'\t':null;
   if(!delimiter)return null;
   let cells=line.split(delimiter).map(value=>value.trim());
   if(delimiter==='|'&&cells[0]==='')cells.shift();
   if(delimiter==='|'&&cells[cells.length-1]==='')cells.pop();
   return cells;
  };
  for(const page of pages){
   const rows=page.text.map(line=>({raw:line,cells:splitCells(line)})).filter(row=>row.cells&&row.cells.length>=2);
   for(let i=0;i<rows.length;i++){
    const header=rows[i].cells;
    if(header.length<3)continue;
    const body=[];
    for(let j=i+1;j<rows.length;j++){
     const cells=rows[j].cells;
     if(cells.length>header.length)break;
     body.push(Array.from({length:header.length},(_,k)=>cells[k]??''));
    }
    if(body.length){
     tables.push({page:page.page,columns:header.map((label,k)=>({key:normalizeKey(label)||'column_'+(k+1),label})),rows:body.map((cells,index)=>({row_number:index+1,cells:cells.map((value,k)=>({column:header[k]||'column_'+(k+1),value,empty:!value}))}))});
     i+=body.length;
    }
   }
  }
  const timetable=[];
  const timetableDay=/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार)$/i;
  for(const page of pages){
   let currentDay='';
   for(const line of page.text){
    if(timetableDay.test(line.trim())){currentDay=line.trim();continue}
    const m=line.match(/\b(\d{1,2}(?:[:.]\d{2})?\s*(?:AM|PM)?)\s*(?:-|–|to)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:AM|PM)?)\b/i);
    if(m)timetable.push({page:page.page,day:currentDay||null,source:line,start_time:m[1].trim(),end_time:m[2].trim()});
   }
  }
  const line_records=[];
  for(const page of pages)for(const line of page.text){
   const cells=line.split(/\s{2,}|\t+/).map(value=>value.trim()).filter(Boolean);
   if(cells.length>=3&&cells.length<=8)line_records.push({page:page.page,fields:cells.map((value,index)=>({key:'field_'+(index+1),value}))});
  }
  return {document_name:String(name||'Untitled document'),schema_version:3,
   extraction_status:pages.length?'success':'no_text',pages,
   structured_data:{key_value,facts,tables,timetable,line_records},
   extraction_notes:pages.length?[]:['No readable text was detected; structured fields are empty until OCR/text extraction succeeds.']};
 }
 global.StudentBrainDocumentExtractor={extract,normalizeKey};
})(window);
