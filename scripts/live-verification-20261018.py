import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import urllib.request
import urllib.error

class HttpResult:
 def __init__(self,response):
  self.status_code=response.status
  self.url=response.url
  self.headers=response.headers
  self.content=response.read()
  self.text=self.content.decode('utf-8',errors='replace')
 def json(self): return json.loads(self.text)

class requests:
 @staticmethod
 def request(method,url,headers=None,json=None,timeout=30):
  import json as jsonlib
  data=None if json is None else jsonlib.dumps(json).encode()
  headers=dict(headers or {})
  if data is not None: headers['Content-Type']='application/json'
  req=urllib.request.Request(url,data=data,headers=headers,method=method)
  try: response=urllib.request.urlopen(req,timeout=timeout)
  except urllib.error.HTTPError as e: response=e
  return HttpResult(response)

BASE = 'https://nexora-guard-core.lovable.app'
DB = 'https://c--f46c7dc2-f8c6-4710-96bb-07ffc11e5270-prod.lovable.cloud'
KEY = 'sb_publishable_eWI2U31KL-zYV8Mn_AzGlw_40-gaGMC'
OUT = Path(__file__).resolve().parents[1] / 'docs/evidence/2026-10-18-http-verification.json'
cases = [(f'page:{p}', 'GET', BASE+p, {}, None, 200) for p in ['/', '/auth', '/pricing', '/terms', '/privacy', '/refund']]
cases += [
 ('anonymous_agent','POST',BASE+'/api/agent',{}, {},401),
 ('invalid_agent','POST',BASE+'/api/agent',{'Authorization':'Bearer invalid'}, {},401),
 ('mcp_get','GET',BASE+'/api/mcp',{},None,405),
 ('mcp_cross_origin','POST',BASE+'/api/mcp',{'Origin':'https://example.invalid'},{'jsonrpc':'2.0','id':1,'method':'tools/list'},403),
 ('mcp_anonymous','POST',BASE+'/api/mcp',{}, {'jsonrpc':'2.0','id':1,'method':'tools/list'},401),
 ('unsigned_paddle','POST',BASE+'/api/paddle/webhook',{}, {},401),
 ('invalid_user_session','GET',DB+'/rest/v1/organizations?select=id',{'apikey':KEY,'Authorization':'Bearer invalid'},None,401),
 ('anonymous_orgs','GET',DB+'/rest/v1/organizations?select=id',{'apikey':KEY},None,200),
]

def probe(case):
 name,method,url,headers,body,expected = case
 at=datetime.datetime.now(datetime.timezone.utc).isoformat()
 try:
  r=requests.request(method,url,headers=headers,json=body,timeout=30)
  text=r.text
  result={'name':name,'at':at,'method':method,'url':url,'final_url':r.url,'status':r.status_code,'expected':expected,'pass':r.status_code==expected,'content_type':r.headers.get('content-type'),'body_sha256':hashlib.sha256(r.content).hexdigest(),'headers':{k:v for k,v in r.headers.items() if k.lower() in ['cache-control','x-content-type-options','strict-transport-security','content-security-policy','x-frame-options','referrer-policy','permissions-policy','allow']}}
  if not name.startswith('page:'): result['body']=text[:1000]
  if name=='anonymous_orgs' and r.status_code==200: result['pass']=r.json()==[]
  if name in ['anonymous_orgs','invalid_user_session'] and r.status_code==403 and '1010' in text:
   result['pass']=None
   result['outcome']='BLOCKED'
   result['blocker']='Request rejected before verified application authorization; do not treat as an RLS/session result.'
  return result
 except Exception as e: return {'name':name,'at':at,'error':str(e),'pass':False}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 results=list(pool.map(probe,cases))
OUT.write_text(json.dumps({'tested_sha':'ef9bf7aa391dba7c82a6f1bc7fdbc6133bb15e67','sha_scope':'repository and Lovable metadata only; served binary not attested','results':results},indent=2)+'\n')
for r in results: print(r['name'],r.get('status'),r['pass'],r.get('body',r.get('error',''))[:150])
