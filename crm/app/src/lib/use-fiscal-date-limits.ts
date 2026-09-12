"use client";
import { useEffect, useState } from "react";

export function useFiscalDateLimits(enabled: boolean, sociedadId: string | undefined, pv: number, tipo: string) {
  const key = `${sociedadId || ""}:${pv}:${tipo}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{key:string;minDate:string|null;error:string;ready:boolean}>({key:"",minDate:null,error:"",ready:false});
  useEffect(() => {
    if (!enabled || !sociedadId) { setState({key:"",minDate:null,error:"",ready:false}); return; }
    const controller = new AbortController();
    setState({key,minDate:null,error:"",ready:false});
    const params=new URLSearchParams({action:"date-limits",sociedad_id:sociedadId,punto_venta:String(pv),tipo});
    fetch(`/api/facturacion?${params}`,{signal:controller.signal,cache:"no-store"})
      .then(async res=>{const data=await res.json();if(!res.ok)throw new Error(data.error);if(data.sociedad_id!==sociedadId || data.punto_venta!==pv || data.tipo!==tipo || !(data.minDate===null || /^\d{4}-\d{2}-\d{2}$/.test(data.minDate)))throw new Error("Respuesta de fechas inválida. Reintentá la consulta.");return data;})
      .then(data=>{if(!controller.signal.aborted)setState({key,minDate:data.minDate,error:"",ready:true});})
      .catch(error=>{if(!controller.signal.aborted)setState({key,minDate:null,error:error.message || "No se pudo verificar la fecha en ARCA.",ready:false});});
    return ()=>controller.abort();
  },[enabled,sociedadId,pv,tipo,key,attempt]);
  const current = state.key === key;
  return {ready:!enabled || (current && state.ready),minDate:current ? state.minDate : null,error:current ? state.error : "",retry:()=>setAttempt(n=>n+1)};
}
