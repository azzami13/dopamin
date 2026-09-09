import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentActor } from "@/lib/auth/authorization";
import { createInternalTransfer } from "@/modules/finance/fund.service";
const schema=z.object({businessDate:z.string().date(),amount:z.coerce.string(),sourceCode:z.string().min(1).max(60),destinationCode:z.string().min(1).max(60),description:z.string().min(1).max(500)});
export async function POST(request:Request){const actor=await getCurrentActor();if(!actor)return NextResponse.json({ok:false,error:{code:"UNAUTHENTICATED",message:"Authentication required"}},{status:401});try{const data=await createInternalTransfer(actor,schema.parse(await request.json()));return NextResponse.json({ok:true,data},{status:201});}catch(error){const e=error as Error&{status?:number;code?:string;issues?:unknown};return NextResponse.json({ok:false,error:{code:e.code??"TRANSFER_FAILED",message:e.message,details:e.issues}},{status:e.status??422});}}
