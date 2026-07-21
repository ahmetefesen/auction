import type {
  AuctionDto,
  BidPreviewDto,
  PublicUser,
  WalletDto,
} from "@auction/shared";
import { apiFetch } from "../api";

export async function getMe(): Promise<{ user: PublicUser; wallet: WalletDto }> {
  return apiFetch("/me");
}

export async function login(email: string, password: string): Promise<{ user: PublicUser }> {
  return apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<{ ok: boolean }> {
  return apiFetch("/auth/logout", { method: "POST" });
}

export async function listAuctions(query?: {
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: AuctionDto[]; total: number }> {
  const params = new URLSearchParams();
  if (query?.status) params.set("status", query.status);
  if (query?.page) params.set("page", String(query.page));
  if (query?.pageSize) params.set("pageSize", String(query.pageSize));
  const qs = params.toString();
  return apiFetch(`/auctions${qs ? `?${qs}` : ""}`);
}

export async function getAuction(id: string): Promise<AuctionDto> {
  return apiFetch(`/auctions/${id}`);
}

export async function placeBid(
  auctionId: string,
  amountCents: number,
  idempotencyKey: string,
): Promise<unknown> {
  return apiFetch(`/auctions/${auctionId}/bids`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ amountCents }),
  });
}

export async function previewBid(
  auctionId: string,
  amountCents: number,
): Promise<BidPreviewDto> {
  return apiFetch(`/auctions/${auctionId}/bid-preview`, {
    method: "POST",
    body: JSON.stringify({ amountCents }),
  });
}

export async function setProxyBid(
  auctionId: string,
  maxAmountCents: number,
): Promise<unknown> {
  return apiFetch(`/auctions/${auctionId}/proxy-bid`, {
    method: "PUT",
    body: JSON.stringify({ maxAmountCents }),
  });
}

export async function getMyProxyBid(
  auctionId: string,
): Promise<{ auctionId: string; maxAmountCents: number | null; updatedAt: string | null }> {
  return apiFetch(`/auctions/${auctionId}/proxy-bid`);
}

export async function getWatchlist(): Promise<{
  items: Array<{
    auctionId: string;
    title: string;
    status: string;
    currentBid: number;
    endsAt: string;
    imageUrl: string | null;
  }>;
}> {
  return apiFetch("/me/watchlist");
}

export async function watchAuction(auctionId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/auctions/${auctionId}/watch`, { method: "POST" });
}

export async function unwatchAuction(auctionId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/auctions/${auctionId}/watch`, { method: "DELETE" });
}

export async function getWallet(): Promise<{
  wallet: WalletDto;
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    heldAfter: number;
    createdAt: string;
  }>;
}> {
  return apiFetch("/wallets/me");
}

export async function deposit(amountCents: number): Promise<{ wallet: WalletDto }> {
  return apiFetch("/wallets/deposit", {
    method: "POST",
    body: JSON.stringify({ amountCents }),
  });
}
