import os,pathlib,shutil,subprocess,tempfile,time
root=pathlib.Path(tempfile.mkdtemp(prefix='wd-cleanup-'));data=root/'data';env=dict(os.environ,PGHOST='127.0.0.1',PGPORT='55463',PGDATABASE='postgres')
def run(a,**kw):return subprocess.run(a,check=True,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kw)
def sql(q):return run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',q],env=env).stdout.strip()
try:
 run(['initdb','-D',str(data),'-A','trust','--no-locale']);run(['pg_ctl','-D',str(data),'-l',str(root/'log'),'-o',f'-h 127.0.0.1 -p 55463 -k {root}','start'])
 sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE svc LOGIN BYPASSRLS; GRANT service_role TO svc; CREATE TABLE public."Space"(id text PRIMARY KEY); CREATE TABLE public."HiringUploadSession"(id text PRIMARY KEY,"spaceId" text REFERENCES public."Space" ON DELETE CASCADE,files jsonb NOT NULL,"createdAt" timestamptz DEFAULT now(),"claimedAt" timestamptz,"completedAt" timestamptz,"applicationId" text,"expiresAt" timestamptz,"requestHash" text); CREATE TABLE public."HiringApplication"(id text PRIMARY KEY,"spaceId" text NOT NULL); CREATE TABLE public."HiringApplicationFile"(id text PRIMARY KEY,"applicationId" text NOT NULL,"spaceId" text NOT NULL,"filePath" text NOT NULL);''')
 for name in ['20261114023449_hiring_upload_cleanup_ledger','20261114030458_hiring_cleanup_backfill','20261114031212_hiring_backfill_retry','20261114033356_hiring_cleanup_retired','20261114044058_hiring_cleanup_cursor','20261114052318_hiring_cleanup_segment']:
  sql(pathlib.Path('prisma/migrations',name,'migration.sql').read_text())
 sql('''GRANT USAGE ON SCHEMA public TO svc; GRANT SELECT,UPDATE ON public."HiringUploadCleanup" TO svc''')
 for role in ['anon','authenticated']:
  assert sql(f"SELECT has_function_privilege('{role}','public.hiring_claim_upload_cleanup()','EXECUTE')")=='f'
  assert sql(f"SELECT has_function_privilege('{role}','public.hiring_finish_upload_cleanup(uuid,boolean)','EXECUTE')")=='f'
  assert sql(f"SELECT has_table_privilege('{role}','public.\"HiringCleanupCursor\"','SELECT')")=='f'
 assert sql('''SELECT relrowsecurity FROM pg_class WHERE oid='public."HiringCleanupCursor"'::regclass''')=='t'
 sid='00000000-0000-4000-8000-000000000001';fid='00000000-0000-4000-8000-000000000002';sp='cabcdefghijklmnopqrstuvwx';path=f'{sp}/applications/{sid}/{fid}.pdf'
 noncuid='550e8400-e29b-41d4-a716-446655440000';nid='00000000-0000-4000-8000-000000000021';npath=f'{noncuid}/applications/{nid}/{fid}.pdf'
 sql(f'''INSERT INTO "Space" VALUES ('{noncuid}'); INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{nid}','{noncuid}','[{{"id":"{fid}","path":"{npath}"}}]',now()+interval '1 day')''')
 assert sql(f'''SELECT "spaceId"='{noncuid}' AND paths @> '["{npath}"]'::jsonb FROM "HiringUploadCleanup" WHERE id='{nid}' ''')=='t'
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT unverified FROM public.hiring_upload_backfill_stats(); COMMIT''')=='0'
 sql('''INSERT INTO "Space" VALUES ('OTHER_TENANT')''')
 try:
  sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('00000000-0000-4000-8000-000000000022','{noncuid}','[{{"id":"{fid}","path":"OTHER_TENANT/applications/00000000-0000-4000-8000-000000000022/{fid}.pdf"}}]',now()+interval '1 day')''')
  raise AssertionError('foreign session path accepted')
 except subprocess.CalledProcessError:pass
 sql(f'''INSERT INTO "HiringApplication" VALUES ('{nid}','{noncuid}'); INSERT INTO "HiringApplicationFile" VALUES ('noncuid-file','{nid}','{noncuid}','{npath}'); UPDATE "HiringUploadSession" SET "completedAt"=now(),"applicationId"='{nid}' WHERE id='{nid}'; UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '1 day' WHERE id='{nid}' ''')
 try:
  sql(f'''INSERT INTO "HiringApplicationFile" VALUES ('foreign-file','{nid}','OTHER_TENANT','OTHER_TENANT/applications/{nid}/{fid}.pdf')''')
  raise AssertionError('foreign application owner accepted')
 except subprocess.CalledProcessError:pass
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='referenced'
 sql(f'''DELETE FROM "HiringApplicationFile" WHERE id='noncuid-file'; UPDATE "HiringUploadCleanup" SET "checkedAt"=NULL WHERE id='{nid}' ''')
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='retired'
 try:
  sql(f'''INSERT INTO "HiringApplicationFile" VALUES ('noncuid-file','{nid}','{noncuid}','{npath}')''')
  raise AssertionError('retired reference accepted')
 except subprocess.CalledProcessError:pass
 sql(f'''DELETE FROM "Space" WHERE id='{noncuid}' ''')
 assert sql(f'''SELECT "spaceId"='{noncuid}' AND paths @> '["{npath}"]'::jsonb AND "retiredAt" IS NOT NULL FROM "HiringUploadCleanup" WHERE id='{nid}' ''')=='t'
 sql('''INSERT INTO "Space" VALUES ('TEAM_UUID-1')''')
 try:
  run(['npx','jest','-c','jest.config.e2e.ts','app/api/hiring-public/upload-sessions/__tests__/segment.local.e2e.test.ts','--runInBand'],env=dict(env,WORKDECK_SEGMENT_LOCAL_TEST='1'))
 except subprocess.CalledProcessError as error:
  print(error.stderr)
  raise
 assert sql('''SELECT count(*) FROM "HiringUploadCleanup" WHERE "spaceId"='TEAM_UUID-1' AND jsonb_array_length(paths)=1''')=='1'
 for i,invalid in enumerate(['..','a/b','percent%2f','back\\slash','홍길동','équipe'],30):
  bad_id=f'00000000-0000-4000-8000-{i:012d}'
  sql(f'''INSERT INTO "Space" VALUES ('{invalid}')''')
  try:
   sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{bad_id}','{invalid}','[{{"id":"{fid}","path":"{invalid}/applications/{bad_id}/{fid}.pdf"}}]',now()+interval '1 day')''')
   raise AssertionError('ambiguous segment accepted')
  except subprocess.CalledProcessError:pass
 active='00000000-0000-4000-8000-000000000007';active_path=f'{sp}/applications/{active}/{fid}.pdf'
 sql(f'''INSERT INTO "Space" VALUES ('{sp}'); INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{active}','{sp}','[{{"id":"{fid}","path":"{active_path}"}}]',now()+interval '1 day'); UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '1 day' WHERE id='{active}' ''')
 sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('00000000-0000-4000-8000-000000000012','{sp}','[]',now()-interval '5 minutes')''')
 assert sql('''UPDATE "HiringUploadSession" SET "claimedAt"=now()-interval '10 minutes', "requestHash"='synthetic-complete' WHERE id='00000000-0000-4000-8000-000000000012' RETURNING id''')==''
 assert sql('''UPDATE "HiringUploadSession" SET "claimedAt"=now(), "requestHash"='recovery-cancelled-v1' WHERE id='00000000-0000-4000-8000-000000000012' RETURNING id''')=='00000000-0000-4000-8000-000000000012'
 sql('''UPDATE "HiringUploadSession" SET "claimedAt"=NULL,"requestHash"=NULL WHERE id='00000000-0000-4000-8000-000000000012' ''')
 try:
  run(['npx','jest','-c','jest.config.e2e.ts','app/api/hiring-public/upload-sessions/__tests__/complete-clock.local.e2e.test.ts','--runInBand'],env=dict(env,WORKDECK_CLEANUP_LOCAL_TEST='1'))
 except subprocess.CalledProcessError as error:
  print(error.stderr)
  raise
 sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt","requestHash") VALUES ('00000000-0000-4000-8000-000000000016','{sp}','[]',now()-interval '5 minutes','same-hash')''')
 assert sql('''UPDATE "HiringUploadSession" SET "claimedAt"=now()-interval '10 minutes',"requestHash"='same-hash' WHERE id='00000000-0000-4000-8000-000000000016' RETURNING id''')==''
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='active'
 assert sql(f'''SELECT "retiredAt" IS NULL FROM "HiringUploadCleanup" WHERE id='{active}' ''')=='t'
 sql(f'''UPDATE "HiringUploadCleanup" SET "checkedAt"=now() WHERE id='{active}' ''')
 bad='00000000-0000-4000-8000-000000000013';bad_path=f'{sp}/applications/{bad}/{fid}.pdf'
 sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt","completedAt") VALUES ('{bad}','{sp}','[{{"id":"{fid}","path":"{bad_path}"}}]',now()-interval '1 day',now()); UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '1 day' WHERE id='{bad}' ''')
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='quarantined'
 assert sql(f'''SELECT quarantined AND "retiredAt" IS NULL FROM "HiringUploadCleanup" WHERE id='{bad}' ''')=='t'
 locked='00000000-0000-4000-8000-000000000014';other='00000000-0000-4000-8000-000000000015'
 for value in [locked,other]:
  candidate_path=f'{sp}/applications/{value}/{fid}.pdf'
  sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{value}','{sp}','[{{"id":"{fid}","path":"{candidate_path}"}}]',now()-interval '1 day'); UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '2 days' WHERE id='{value}' ''')
 leader=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 leader.stdin.write(f'''BEGIN; SELECT id FROM "HiringUploadSession" WHERE id='{locked}' FOR UPDATE; SELECT 'LOCKED';\n''');leader.stdin.flush();assert leader.stdout.readline().strip()==locked;assert leader.stdout.readline().strip()=='LOCKED'
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='retired'
 locked_ledger='00000000-0000-4000-8000-000000000017';other_ledger='00000000-0000-4000-8000-000000000018'
 for value in [locked_ledger,other_ledger]:
  candidate_path=f'{sp}/applications/{value}/{fid}.pdf'
  sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{value}','{sp}','[{{"id":"{fid}","path":"{candidate_path}"}}]',now()-interval '1 day'); UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '2 days' WHERE id='{value}' ''')
 ledger_holder=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 ledger_holder.stdin.write(f'''BEGIN; SELECT id FROM "HiringUploadCleanup" WHERE id='{locked_ledger}' FOR UPDATE; SELECT 'LOCKED';\n''');ledger_holder.stdin.flush();assert ledger_holder.stdout.readline().strip()==locked_ledger;assert ledger_holder.stdout.readline().strip()=='LOCKED'
 claimant=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 claimant.stdin.write("BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); SELECT 'CLAIMED';\n");claimant.stdin.flush();assert claimant.stdout.readline().strip()=='retired';assert claimant.stdout.readline().strip()=='CLAIMED'
 assert sql(f'''BEGIN; SET LOCAL lock_timeout='100ms'; SELECT id FROM "HiringUploadSession" WHERE id='{locked_ledger}' FOR UPDATE; COMMIT''')==locked_ledger
 claimant.stdin.write('COMMIT;\n\\q\n');claimant.stdin.flush();_,err=claimant.communicate(timeout=10);assert claimant.returncode==0,err
 ledger_holder.stdin.write('ROLLBACK;\n\\q\n');ledger_holder.stdin.flush();_,err=ledger_holder.communicate(timeout=10);assert ledger_holder.returncode==0,err
 sql(f'''UPDATE "HiringUploadCleanup" SET "checkedAt"=now() WHERE id='{locked_ledger}' ''')
 assert sql(f'''SELECT "retiredAt" IS NULL FROM "HiringUploadCleanup" WHERE id='{locked}' ''')=='t'
 assert sql(f'''SELECT "retiredAt" IS NOT NULL FROM "HiringUploadCleanup" WHERE id='{other}' ''')=='t'
 leader.stdin.write('COMMIT;\n\\q\n');leader.stdin.flush();_,err=leader.communicate(timeout=10);assert leader.returncode==0,err
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='retired'
 sql('''INSERT INTO "HiringUploadCleanup"(id,"spaceId",paths,quarantined,"createdAt") VALUES ('private@example.test','', '[]',false,now()-interval '1 day')''')
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='quarantined'
 assert sql('''SELECT position('private@example.test' in row_to_json(c)::text)=0 FROM "HiringCleanupCursor" c''')=='t'
 sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{sid}','{sp}','[{{"id":"{fid}","path":"{path}"}}]',now()-interval '1 day'); INSERT INTO "HiringApplication" VALUES ('{sid}','{sp}'); UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '1 day' WHERE id='{sid}' ''')
 assert sql(f'''UPDATE "HiringUploadSession" SET "claimedAt"=now() WHERE id='{sid}' RETURNING id''')==''
 assert sql(f'''UPDATE "HiringUploadSession" SET "claimedAt"=now(),"requestHash"='recovery-cancelled-v1' WHERE id='{sid}' RETURNING id''')==sid
 sql(f'''UPDATE "HiringUploadSession" SET "claimedAt"=NULL,"requestHash"=NULL WHERE id='{sid}' ''')
 sql(f'''UPDATE "HiringUploadSession" SET "completedAt"=now(),"applicationId"='{sid}' WHERE id='{sid}'; INSERT INTO "HiringApplicationFile" VALUES ('{fid}','{sid}','{sp}','{path}')''')
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='referenced'
 sid9='00000000-0000-4000-8000-000000000011';path9=f'{sp}/applications/{sid9}/{fid}.pdf'
 sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{sid9}','{sp}','[{{"id":"{fid}","path":"{path9}"}}]',now()-interval '1 day'); UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '1 day' WHERE id='{sid9}' ''')
 leader=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 leader.stdin.write(f'''BEGIN; UPDATE "HiringUploadSession" SET "claimedAt"=now(),"requestHash"='recovery-cancelled-v1' WHERE id='{sid9}'; SELECT 'LOCKED';\n''');leader.stdin.flush();assert leader.stdout.readline().strip()=='LOCKED'
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='blocked'
 leader.stdin.write('COMMIT;\n\\q\n');leader.stdin.flush();_,err=leader.communicate(timeout=10);assert leader.returncode==0,err
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='retired'
 sql(f'''DELETE FROM "HiringApplicationFile"; UPDATE "HiringUploadCleanup" SET "checkedAt"=NULL WHERE id='{sid}' ''')
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='retired'
 assert sql(f'''SELECT "retiredAt" IS NOT NULL FROM "HiringUploadCleanup" WHERE id='{sid}' ''')=='t'
 sql(f'''UPDATE "HiringUploadSession" SET files=files WHERE id='{sid}' ''')
 try:
  sql(f'''UPDATE "HiringUploadSession" SET files='[]' WHERE id='{sid}' ''')
  raise AssertionError('retired session changed')
 except subprocess.CalledProcessError:pass
 legacy='c'+'a'*24
 sql(f'''INSERT INTO "Space" VALUES ('legacy-space'); INSERT INTO "HiringApplication" VALUES ('{legacy}','legacy-space'); INSERT INTO "HiringApplicationFile" VALUES ('legacy-file','{legacy}','legacy-space','legacy-space/applications/{legacy}/{fid}.pdf'); INSERT INTO "HiringApplicationFile" VALUES ('migration-file','{legacy}','legacy-space','legacy-space/migration/{'a'*64}/{'b'*64}')''')
 assert sql('''SELECT count(*) FROM "HiringApplicationFile" WHERE "spaceId"='legacy-space' ''')=='2'
 sql('''ALTER TABLE "HiringApplicationFile" DISABLE TRIGGER hiring_guard_file_reference;
 INSERT INTO "HiringApplicationFile" SELECT 'bulk-'||n,'synthetic','legacy-space','synthetic-'||n FROM generate_series(1,20000) n;
 ALTER TABLE "HiringApplicationFile" ENABLE TRIGGER hiring_guard_file_reference; ANALYZE "HiringApplicationFile"''')
 plan=sql(f'''EXPLAIN SELECT 1 FROM (SELECT v.entry FROM jsonb_array_elements_text('["{path}"]'::jsonb) AS v(entry) LIMIT 3) AS expanded JOIN "HiringApplicationFile" AS f ON f."filePath"=expanded.entry''')
 assert 'HiringApplicationFile_filePath_idx' in plan,plan
 sid2='00000000-0000-4000-8000-000000000003';path2=f'{sp}/applications/{sid2}/{fid}.pdf'
 sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{sid2}','{sp}','[{{"id":"{fid}","path":"{path2}"}}]',now()-interval '1 day'); INSERT INTO "HiringApplication" VALUES ('{sid2}','{sp}'); UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '1 day' WHERE id='{sid2}' ''')
 leader=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 leader.stdin.write(f'''BEGIN; UPDATE "HiringUploadSession" SET "completedAt"=now(),"applicationId"='{sid2}' WHERE id='{sid2}'; INSERT INTO "HiringApplicationFile" VALUES ('ref2','{sid2}','{sp}','{path2}'); SELECT 'LOCKED';\n''');leader.stdin.flush();assert leader.stdout.readline().strip()=='LOCKED'
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='blocked'
 leader.stdin.write('COMMIT;\n\\q\n');leader.stdin.flush();_,err=leader.communicate(timeout=10);assert leader.returncode==0,err
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='referenced'
 sql('''DELETE FROM "HiringApplicationFile" WHERE id='ref2'; UPDATE "HiringUploadCleanup" SET "checkedAt"=NULL WHERE id='00000000-0000-4000-8000-000000000003' ''')
 leader=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 leader.stdin.write("BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); SELECT 'LOCKED';\n");leader.stdin.flush();assert leader.stdout.readline().strip()=='retired';assert leader.stdout.readline().strip()=='LOCKED'
 follower=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',f'''INSERT INTO "HiringApplicationFile" VALUES ('ref2','{sid2}','{sp}','{path2}')'''],env=dict(env,PGAPPNAME='wd_reference_wait'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 for _ in range(100):
  if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='wd_reference_wait' AND wait_event_type='Lock'")=='1':break
  time.sleep(.02)
 else:raise AssertionError('reference lock wait not observed')
 leader.stdin.write('COMMIT;\n\\q\n');leader.stdin.flush();_,err=leader.communicate(timeout=10);assert leader.returncode==0,err
 _,err=follower.communicate(timeout=10);assert follower.returncode!=0 and 'file reference rejected' in err
 sid3='00000000-0000-4000-8000-000000000004';path3=f'{sp}/applications/{sid3}/{fid}.pdf'
 sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{sid3}','{sp}','[{{"id":"{fid}","path":"{path3}"}}]',now()-interval '1 day'); INSERT INTO "HiringApplication" VALUES ('{sid3}','{sp}'); UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '1 day' WHERE id='{sid3}' ''')
 stale=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 stale.stdin.write(f'''BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT count(*) FROM "HiringUploadCleanup" WHERE id='{sid3}'; SELECT 'SNAPSHOT';\n''');stale.stdin.flush();assert stale.stdout.readline().strip()=='1';assert stale.stdout.readline().strip()=='SNAPSHOT'
 sql(f'''UPDATE "HiringUploadSession" SET "completedAt"=now(),"applicationId"='{sid3}' WHERE id='{sid3}'; INSERT INTO "HiringApplicationFile" VALUES ('ref3','{sid3}','{sp}','{path3}')''')
 stale.stdin.write('''SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT;\n\\q\n''');stale.stdin.flush();_,err=stale.communicate(timeout=10)
 assert stale.returncode!=0 and 'could not serialize access' in err
 assert sql(f'''SELECT "retiredAt" IS NULL FROM "HiringUploadCleanup" WHERE id='{sid3}' ''')=='t'
 sid6='00000000-0000-4000-8000-000000000008';path6=f'{sp}/applications/{sid6}/{fid}.pdf'
 sql(f'''UPDATE "HiringUploadCleanup" SET "checkedAt"=now() WHERE id='{sid3}'; INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{sid6}','{sp}','[{{"id":"{fid}","path":"{path6}"}}]',now()+interval '1 day'); DELETE FROM "HiringUploadSession" WHERE id='{sid6}'; UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '1 day' WHERE id='{sid6}' ''')
 insertion=f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{sid6}','{sp}','[{{"id":"{fid}","path":"{path6}"}}]',now()+interval '1 day')'''
 leader=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 leader.stdin.write('BEGIN; '+insertion+"; SELECT 'LOCKED';\n");leader.stdin.flush();assert leader.stdout.readline().strip()=='LOCKED'
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='blocked'
 leader.stdin.write('COMMIT;\n\\q\n');leader.stdin.flush();_,err=leader.communicate(timeout=10);assert leader.returncode==0,err
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='active'
 assert sql(f'''SELECT "retiredAt" IS NULL FROM "HiringUploadCleanup" WHERE id='{sid6}' ''')=='t'
 sql(f'''DELETE FROM "HiringUploadSession" WHERE id='{sid6}'; UPDATE "HiringUploadCleanup" SET "checkedAt"=NULL WHERE id='{sid6}' ''')
 for level in ['REPEATABLE READ','SERIALIZABLE']:
  stale=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  stale.stdin.write(f'''BEGIN ISOLATION LEVEL {level}; SELECT count(*) FROM "HiringUploadCleanup" WHERE id='{sid6}'; SELECT 'SNAPSHOT';\n''');stale.stdin.flush();assert stale.stdout.readline().strip()=='1';assert stale.stdout.readline().strip()=='SNAPSHOT'
  sql(insertion)
  stale.stdin.write('''SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT;\n\\q\n''');stale.stdin.flush();_,err=stale.communicate(timeout=10)
  assert stale.returncode!=0 and 'could not serialize access' in err
  assert sql(f'''SELECT "retiredAt" IS NULL FROM "HiringUploadCleanup" WHERE id='{sid6}' ''')=='t'
  sql(f'''DELETE FROM "HiringUploadSession" WHERE id='{sid6}' ''')
 sql(f'''UPDATE "HiringUploadCleanup" SET "checkedAt"=now() WHERE id='{sid6}' ''')
 sid7='00000000-0000-4000-8000-000000000009';path7=f'{sp}/applications/{sid7}/{fid}.pdf'
 insertion7=f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{sid7}','{sp}','[{{"id":"{fid}","path":"{path7}"}}]',now()+interval '1 day')'''
 sql(insertion7+f'''; DELETE FROM "HiringUploadSession" WHERE id='{sid7}'; UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '1 day' WHERE id='{sid7}' ''')
 leader=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 leader.stdin.write('BEGIN; '+insertion7+"; SELECT 'LOCKED';\n");leader.stdin.flush();assert leader.stdout.readline().strip()=='LOCKED'
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='blocked'
 leader.stdin.write('ROLLBACK;\n\\q\n');leader.stdin.flush();_,err=leader.communicate(timeout=10);assert leader.returncode==0,err
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='retired'
 sid8='00000000-0000-4000-8000-000000000010';path8=f'{sp}/applications/{sid8}/{fid}.pdf'
 sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{sid8}','{sp}','[{{"id":"{fid}","path":"{path8}"}}]',now()+interval '1 day'); INSERT INTO "HiringApplication" VALUES ('{sid8}','{sp}'); UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '1 day' WHERE id='{sid8}' ''')
 leader=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 leader.stdin.write(f'''BEGIN; UPDATE "HiringUploadSession" SET "claimedAt"=now(),"requestHash"='complete',"completedAt"=now(),"applicationId"='{sid8}' WHERE id='{sid8}'; INSERT INTO "HiringApplicationFile" VALUES ('ref8','{sid8}','{sp}','{path8}'); SELECT 'LOCKED';\n''');leader.stdin.flush();assert leader.stdout.readline().strip()=='LOCKED'
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='blocked'
 leader.stdin.write('COMMIT;\n\\q\n');leader.stdin.flush();_,err=leader.communicate(timeout=10);assert leader.returncode==0,err
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='referenced'
 sid4='00000000-0000-4000-8000-000000000005';path4=f'{sp}/applications/{sid4}/{fid}.pdf'
 sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{sid4}','{sp}','[{{"id":"{fid}","path":"{path4}"}}]',now()-interval '1 day'); UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '1 day' WHERE id='{sid4}' ''')
 try:
  run(['npx','jest','-c','jest.config.e2e.ts','app/api/cron/hiring-upload-cleanup/__tests__/route.local.e2e.test.ts','--runInBand'],env=dict(env,WORKDECK_CLEANUP_LOCAL_TEST='1',DIRECT_URL='postgresql://svc@127.0.0.1:55463/postgres',NODE_ENV='test'))
 except subprocess.CalledProcessError as error:
  print(error.stderr)
  raise
 sid5='00000000-0000-4000-8000-000000000006';path5=f'{sp}/applications/{sid5}/{fid}.pdf'
 sql(f'''UPDATE "HiringUploadCleanup" SET "checkedAt"=now() WHERE id='{sid3}'; INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") VALUES ('{sid5}','{sp}','[{{"id":"{fid}","path":"{path5}"}}]',now()-interval '1 day'); UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '1 day' WHERE id='{sid5}' ''')
 leader=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 leader.stdin.write("BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); SELECT 'LOCKED';\n");leader.stdin.flush();assert leader.stdout.readline().strip()=='retired';assert leader.stdout.readline().strip()=='LOCKED'
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='blocked'
 leader.stdin.write('COMMIT;\n\\q\n');leader.stdin.flush();_,err=leader.communicate(timeout=10);assert leader.returncode==0,err
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')==''
 old_token=sql(f'''SELECT "leaseToken" FROM "HiringUploadCleanup" WHERE id='{sid5}' ''')
 sql(f'''UPDATE "HiringUploadCleanup" SET "leaseToken"=gen_random_uuid() WHERE id='{sid5}' ''')
 assert sql(f'''BEGIN; SET LOCAL ROLE service_role; SELECT public.hiring_finish_upload_cleanup('{old_token}'::uuid,true); COMMIT''')=='f'
 sql(f'''INSERT INTO "HiringUploadSession"(id,"spaceId",files,"expiresAt") SELECT '40000000-0000-4000-8000-'||lpad(n::text,12,'0'),'{sp}',jsonb_build_array(jsonb_build_object('id','{fid}','path','{sp}/applications/'||'40000000-0000-4000-8000-'||lpad(n::text,12,'0')||'/{fid}.pdf')),now()-interval '1 day' FROM generate_series(1,51) n; UPDATE "HiringUploadCleanup" SET "createdAt"=now()-interval '3 days' WHERE id LIKE '40000000-%' ''')
 leader=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 leader.stdin.write('''BEGIN; SELECT id FROM "HiringUploadSession" WHERE id LIKE '40000000-%' ORDER BY id LIMIT 50 FOR UPDATE; SELECT 'LOCKED';\n''');leader.stdin.flush()
 for _ in range(50):assert leader.stdout.readline().strip().startswith('40000000-')
 assert leader.stdout.readline().strip()=='LOCKED'
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='skipped_limit'
 assert sql('''SELECT count(*) FROM "HiringUploadCleanup" WHERE id LIKE '40000000-%' AND "retiredAt" IS NOT NULL''')=='0'
 checkpoint=sql('''SELECT "ledgerId" FROM "HiringCleanupCursor" WHERE id=1''')
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); ROLLBACK''')=='retired'
 assert sql('''SELECT "ledgerId" FROM "HiringCleanupCursor" WHERE id=1''')==checkpoint
 assert sql('''SELECT count(*) FROM "HiringUploadCleanup" WHERE id LIKE '40000000-%' AND "retiredAt" IS NOT NULL''')=='0'
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='retired'
 assert sql('''SELECT count(*) FROM "HiringUploadCleanup" WHERE id LIKE '40000000-%' AND "retiredAt" IS NOT NULL''')=='1'
 leader.stdin.write('COMMIT;\n\\q\n');leader.stdin.flush();_,err=leader.communicate(timeout=10);assert leader.returncode==0,err
 assert sql('''BEGIN; SET LOCAL ROLE service_role; SELECT outcome FROM public.hiring_claim_upload_cleanup(); COMMIT''')=='retired'
 try:
  sql(f'''INSERT INTO "HiringApplicationFile" VALUES ('{fid}','{sid}','{sp}','{path}')''')
  raise AssertionError('retired reference accepted')
 except subprocess.CalledProcessError:pass
 print('PASS: referenced file protected, retirement committed, subsequent reference rejected')
finally:
 if (data/'postmaster.pid').exists():subprocess.run(['pg_ctl','-D',str(data),'stop','-m','fast'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 shutil.rmtree(root,ignore_errors=True)
