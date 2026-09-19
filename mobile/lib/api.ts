import * as SecureStore from 'expo-secure-store';
export const API_URL=(process.env.EXPO_PUBLIC_API_URL||'http://localhost:4000/api').replace(/\/$/,'');
const ACCESS='clutchnex_access';
export async function token(){return SecureStore.getItemAsync(ACCESS)}
export async function setToken(value:string){return SecureStore.setItemAsync(ACCESS,value)}
export async function clearToken(){return SecureStore.deleteItemAsync(ACCESS)}
export async function api<T>(path:string, options:RequestInit={}){const t=await token();const res=await fetch(`${API_URL}${path}`,{...options,headers:{'content-type':'application/json',...(t?{authorization:`Bearer ${t}`}:{}) ,...(options.headers||{})}});const body=await res.json().catch(()=>({}));if(!res.ok)throw new Error(body.message||'Something went wrong.');return (body.data??body) as T}
export const auth={login:(identifier:string,password:string)=>api<{accessToken:string;user:User}>('/auth/login',{method:'POST',body:JSON.stringify({identifier,password})}),register:(input:Record<string,string>)=>api('/auth/register',{method:'POST',body:JSON.stringify(input)}),forgot:(email:string)=>api('/auth/forgot-password',{method:'POST',body:JSON.stringify({email})}),me:()=>api<User & {freeFireUID?:string;freeFireIGN?:string}>('/auth/me'),updateProfile:(input:Record<string,unknown>)=>api('/auth/profile',{method:'PUT',body:JSON.stringify(input)}),logout:()=>api('/auth/logout',{method:'POST'})};
export type User={id:string;username:string;email?:string;role?:string;avatarUrl?:string};
export type Tournament={id:string;slug:string;title:string;type:string;status:string;entryFeePerPlayer:number|string;prizePool:number|string;startsInMs?:number;registeredSlots:number;maxSlots:number;banner?:string};
export const joinTournament=(tournamentSlug:string)=>api('/tournaments/join',{method:'POST',body:JSON.stringify({tournamentSlug})});
export const queries={home:()=>api<{items:Tournament[]}>('/public/tournaments?limit=6'),tournaments:(query='')=>api<{items:Tournament[]}>('/public/tournaments?limit=30'+query),tournament:(slug:string)=>api<Tournament>(`/public/tournaments/${slug}`),matches:()=>api<{items:unknown[]}>('/matches/my'),leaderboard:()=>api<{items:unknown[]}>('/public/leaderboard?limit=20'),notifications:()=>api<{items:unknown[]}>('/notifications')};
