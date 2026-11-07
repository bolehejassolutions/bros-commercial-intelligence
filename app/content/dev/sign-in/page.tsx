'use client';
/** Isolated BROS CONTENT sign-in. No sign-up or password collection by ChatGPT. */
import {useState,type FormEvent} from 'react';
import {createAuthClient} from '@neondatabase/auth/next';

const authClient=createAuthClient();
export default function ContentDevSignIn(){
 const[email,setEmail]=useState('');
 const[password,setPassword]=useState('');
 const[busy,setBusy]=useState(false);
 const[error,setError]=useState('');
 async function signIn(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError('');
  try{
   const result=await authClient.signIn.email({email,password});
   if(result.error){setError('Sign-in failed. Check your credentials or your Neon Auth provider configuration.');return;}
   window.location.assign('/content/dev');
  }catch{setError('Sign-in is currently unavailable.');}
  finally{setBusy(false);}
 }
 return <main style={{maxWidth:440,margin:'6rem auto',padding:'1.5rem',fontFamily:'system-ui'}}>
  <p style={{fontSize:12,letterSpacing:2}}>BROS CONTENT · DEVELOPMENT</p>
  <h1>Sign in</h1>
  <p>Internal Preview only. Use an existing authorized Neon Auth account.</p>
  <form onSubmit={signIn} style={{display:'grid',gap:12}}>
   <label>Email<input type="email" required autoComplete="username" value={email}
    onChange={event=>setEmail(event.target.value)} style={{display:'block',width:'100%',padding:10}}/></label>
   <label>Password<input type="password" required autoComplete="current-password" value={password}
    onChange={event=>setPassword(event.target.value)} style={{display:'block',width:'100%',padding:10}}/></label>
   <button type="submit" disabled={busy} style={{padding:12}}>{busy?'Signing in…':'Sign in'}</button>
   {error&&<p role="alert">{error}</p>}
  </form>
  <p style={{marginTop:24,fontSize:12}}>No public registration, campaign generation, publishing, payments, or credit changes are enabled here.</p>
 </main>;
}
