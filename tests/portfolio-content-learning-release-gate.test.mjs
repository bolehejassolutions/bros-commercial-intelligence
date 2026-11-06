/**
 * PORTFOLIO_BCI_LEARNING_GATE_CONSUMER_PARITY_20261027_1730
 * Coordinator-only exact-source acceptance of the BCI worker's repaired gate.
 * All rows below are SYNTHETIC and caller-supplied; never provider evidence,
 * authenticated membership, an approved SENT, or a release attestation.
 * No BCI product/backend code, DB, permissions, or provider state is modified.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const bciCommit='ddebb07d95258c2eec3cd87fe3ce7249c9a7e95c';
const files=[
  'lib/bci/internal-readiness.ts',
  'lib/bci/content-evidence-gate.ts',
  'lib/bci/demand-experiment-gate.ts',
];
const tenantId='33333333-3333-4333-8333-333333333333';
const contentId='synthetic-content-learning-gate';
const experimentId='synthetic-experiment-learning-gate';
const contentStages=['media_qa','approval','provider_sent','measurement','learning'];
const demandStages=['diagnosis','decision','action','outcome','learning'];

if(process.env.GITHUB_ACTIONS!=='true'){
  test.skip('exact-source shared BCI consumer gate runs in GitHub Actions');
}else{
  test('latest shared BCI learning gate fails closed for missing, forged and untrusted evidence',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bros-bci-learning-gate-'));
    try{
      execFileSync('git',['init','--quiet',dir],{stdio:'pipe',timeout:15000});
      execFileSync('git',['-C',dir,'remote','add','origin',
        'https://github.com/bolehejassolutions/bros-commercial-intelligence.git'],
        {stdio:'pipe',timeout:15000});
      execFileSync('git',['-C',dir,'fetch','--no-tags','--depth=1','origin',bciCommit],
        {stdio:'pipe',timeout:60000,maxBuffer:2097152});
      for(const path of files){
        const src=execFileSync('git',['-C',dir,'show',bciCommit+':'+path],
          {encoding:'utf8',timeout:15000,maxBuffer:2097152});
        const target=join(dir,path);
        mkdirSync(dirname(target),{recursive:true});
        writeFileSync(target,src,{mode:0o600});
      }
      const {assessInternalReadiness}=await import(
        pathToFileURL(join(dir,files[0])).href);
      const contentEvidence=contentStages.map((stage,i)=>({
        tenantId,product:'content',contentId,stage,
        sourceKey:'synthetic:content:'+stage,verified:true,
        at:new Date(Date.UTC(2026,9,27,1,i)).toISOString(),
        ...(stage==='provider_sent'?{providerPostId:'synthetic-post'}:{}),
        ...(stage==='learning'?{measurementSourceKey:'synthetic:content:measurement'}:{}),
      }));
      const demandEvidence=demandStages.map((stage,i)=>({
        tenantId,product:'demand',experimentId,stage,
        sourceKey:'synthetic:demand:'+stage,verified:true,
        observedAt:new Date(Date.UTC(2026,9,27,2,i)).toISOString(),
        ...(stage==='outcome'?{outcomeClass:'provider_verified'}:{}),
      }));
      const inputs={tenantId,contentId,contentEvidence,experimentId,demandEvidence,
        neonNegativeTestsVerified:true,sharedBciAuditVerified:true,
        hitpayReconciliationVerified:true};
      // Missing CONTENT learning must not be silently accepted.
      const missing=assessInternalReadiness({
        ...inputs,contentEvidence:contentEvidence.slice(0,-1)});
      assert.equal(missing.contentEvidenceComplete,false);
      assert.equal(missing.unattestedCandidateComplete,false);
      assert.equal(missing.internalV1Ready,false);
      assert.ok(missing.pending.includes('contentEvidenceComplete'));
      assert.ok(missing.pending.includes('authenticatedEndToEndAttestation'));
      // Even a fully linked synthetic chain + asserted flags cannot release.
      const synthetic=assessInternalReadiness(inputs);
      assert.equal(synthetic.contentEvidenceComplete,true);
      assert.equal(synthetic.demandEvidenceComplete,true);
      assert.equal(synthetic.unattestedCandidateComplete,true);
      assert.equal(synthetic.internalV1Ready,false);
      assert.deepEqual(synthetic.pending,['authenticatedEndToEndAttestation']);
      assert.equal(Object.isFrozen(synthetic.pending),true);
      // A forged measurement reference is a hard error, not a green gate.
      assert.throws(()=>assessInternalReadiness({...inputs,
        contentEvidence:contentEvidence.map(row=>row.stage==='learning'
          ?{...row,measurementSourceKey:'synthetic:unrelated-measurement'}:row)
      }),/Invalid CONTENT evidence/);
      // A caller cannot bypass trusted attestation with truthy string flags.
      const untrusted=assessInternalReadiness({...inputs,
        neonNegativeTestsVerified:'true',sharedBciAuditVerified:1,
        hitpayReconciliationVerified:'yes'});
      assert.equal(untrusted.unattestedCandidateComplete,false);
      assert.equal(untrusted.internalV1Ready,false);
      assert.ok(untrusted.pending.includes('neonNegativeTestsVerified'));
      // Replay is deterministic, but replay does not confer trust.
      assert.deepEqual(assessInternalReadiness(inputs),synthetic);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
