import { NextResponse } from 'next/server';

/** Shared 404 for YidaLab internal build profile (heavy product routes). */
export const notFoundResponse = () =>
  NextResponse.json({ error: 'Not available in this deployment profile' }, { status: 404 });

export const GET = async () => notFoundResponse();
export const POST = async () => notFoundResponse();
export const PUT = async () => notFoundResponse();
export const PATCH = async () => notFoundResponse();
export const DELETE = async () => notFoundResponse();
export const OPTIONS = async () => notFoundResponse();
