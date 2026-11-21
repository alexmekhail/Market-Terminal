import type { PortfolioPosition } from '@/types';

export interface ValuedPosition extends PortfolioPosition {
  currentPrice?: number;
  currentValue?: number;
  gainLoss?: number;
  gainLossPercent?: number;
}

export function valuePosition(position: PortfolioPosition, currentPrice?: number): ValuedPosition {
  if (currentPrice === undefined) return position;
  const currentValue = currentPrice * position.shares;
  const costBasis = position.avg_buy_price * position.shares;
  const gainLoss = currentValue - costBasis;
  const gainLossPercent = costBasis !== 0 ? (gainLoss / costBasis) * 100 : 0;
  return { ...position, currentPrice, currentValue, gainLoss, gainLossPercent };
}
