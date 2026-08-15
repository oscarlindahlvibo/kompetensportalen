"use client";

import { useState } from "react";

type CartItem = { courseSlug: string; name: string; quantity: number };
const CART_KEY = "kompetensportalen-cart";

export function readCart(): CartItem[] { if (typeof window === "undefined") return []; try { return JSON.parse(window.localStorage.getItem(CART_KEY) ?? "[]") as CartItem[]; } catch { return []; } }
export function writeCart(items: CartItem[]) { window.localStorage.setItem(CART_KEY, JSON.stringify(items)); window.dispatchEvent(new Event("kompetensportalen-cart-change")); }

export default function AddToCart({ courseSlug, name }: { courseSlug: string; name: string }) {
  const [added, setAdded] = useState(false);
  function add() { const items = readCart(); const existing = items.find((item) => item.courseSlug === courseSlug); if (existing) existing.quantity += 1; else items.push({ courseSlug, name, quantity: 1 }); writeCart(items); setAdded(true); window.setTimeout(() => setAdded(false), 1800); }
  return <button className="button button-light" type="button" onClick={add}>{added ? "Tillagd i varukorgen" : "Lägg i varukorg"} <span>+</span></button>;
}
