import React from 'react';
import { Badge, Empty, LayerCard, Text } from '@cloudflare/kumo';
import type { TrafficSample, TrafficSnapshot } from '../../observer/types';
import { formatByteRate, formatPercent } from '../format';
import type { Translator } from '../i18n';

interface TrafficChartProps {
  traffic?: TrafficSnapshot | null;
  t: Translator;
}

const WIDTH = 720;
const HEIGHT = 220;
const PADDING_X = 44;
const PADDING_Y = 26;

export function TrafficChart({ traffic, t }: TrafficChartProps) {
  const samples = traffic?.samples ?? [];
  const chartSamples = samples.slice(-60);
  const latest = samples.at(-1);
  const scale = trafficScale(chartSamples);
  const rxPoints = linePoints(chartSamples, 'rxBytesPerSecond', scale.max);
  const txPoints = linePoints(chartSamples, 'txBytesPerSecond', scale.max);
  const rxLast = pointAt(chartSamples, 'rxBytesPerSecond', scale.max, chartSamples.length - 1);
  const txLast = pointAt(chartSamples, 'txBytesPerSecond', scale.max, chartSamples.length - 1);
  const firstTime = chartSamples.at(0)?.timestamp;
  const lastTime = chartSamples.at(-1)?.timestamp;

  return <LayerCard>
    <LayerCard.Secondary>
      {t('overview.trafficChart')} {latest ? <Badge variant="outline">{latest.timestamp}</Badge> : null}
    </LayerCard.Secondary>
    <LayerCard.Primary>
      <div className="stack compact">
        <Text as="p" variant="secondary" size="sm">{t('overview.trafficChartHelp')}</Text>
        {samples.length < 2
          ? <Empty title={t('overview.noTrafficTitle')} description={t('overview.noTrafficDescription')} />
          : <div className="traffic-chart-panel">
            <div className="chart-summary-grid" aria-label={t('overview.trafficChart')}>
              <ChartStat label={t('overview.trafficCurrent')} value={`${t('common.rx')} ${formatByteRate(latest?.rxBytesPerSecond ?? 0)} / ${t('common.tx')} ${formatByteRate(latest?.txBytesPerSecond ?? 0)}`} />
              <ChartStat label={t('overview.trafficPeak')} value={formatByteRate(scale.max)} />
              <ChartStat label={t('overview.trafficSamples')} value={chartSamples.length} />
              <ChartStat label={t('common.relayDropRate')} value={formatPercent(traffic?.summary.relayDropRate)} />
            </div>
            <div className="traffic-chart" role="img" aria-label={`${t('overview.trafficChart')}: ${formatByteRate(scale.max)} ${t('overview.trafficScale')}`}>
              <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="traffic-rx-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-kumo-brand, #2563eb)" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="var(--color-kumo-brand, #2563eb)" stopOpacity="0.02" />
                  </linearGradient>
                  <linearGradient id="traffic-tx-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-kumo-success, #11845b)" stopOpacity="0.20" />
                    <stop offset="100%" stopColor="var(--color-kumo-success, #11845b)" stopOpacity="0.01" />
                  </linearGradient>
                </defs>
                <GridLines max={scale.max} />
                <polygon className="traffic-area rx" points={areaPoints(rxPoints)} />
                <polygon className="traffic-area tx" points={areaPoints(txPoints)} />
                <polyline className="traffic-line rx" points={rxPoints} />
                <polyline className="traffic-line tx" points={txPoints} />
                {rxLast && <circle className="traffic-endpoint rx" cx={rxLast.x} cy={rxLast.y} r="4" />}
                {txLast && <circle className="traffic-endpoint tx" cx={txLast.x} cy={txLast.y} r="4" />}
                <text className="chart-axis-label chart-axis-max" x={PADDING_X - 8} y={PADDING_Y + 4}>{formatByteRate(scale.max)}</text>
                <text className="chart-axis-label" x={PADDING_X - 8} y={HEIGHT - PADDING_Y + 4}>0</text>
              </svg>
              <div className="chart-time-axis">
                <span>{formatTime(firstTime)}</span>
                <span>{formatTime(lastTime)}</span>
              </div>
            </div>
            <div className="chart-legend">
              <span><i className="legend-swatch rx" />{t('common.rx')} {formatByteRate(latest?.rxBytesPerSecond ?? 0)}</span>
              <span><i className="legend-swatch tx" />{t('common.tx')} {formatByteRate(latest?.txBytesPerSecond ?? 0)}</span>
              <span>{t('common.relayDropRate')} {formatPercent(traffic?.summary.relayDropRate)}</span>
            </div>
          </div>}
      </div>
    </LayerCard.Primary>
  </LayerCard>;
}

function ChartStat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="chart-stat">
    <Text as="span" variant="secondary" size="sm">{label}</Text>
    <Text as="strong" variant="body">{value}</Text>
  </div>;
}

function GridLines({ max }: { max: number }) {
  return <>
    {[0, 1, 2, 3].map((index) => {
      const y = PADDING_Y + (index * (HEIGHT - PADDING_Y * 2)) / 3;
      return <g key={index}>
        <line className="chart-grid-line" x1={PADDING_X} x2={WIDTH - PADDING_X} y1={y} y2={y} />
        {index === 1 && <text className="chart-axis-label" x={PADDING_X - 8} y={y + 4}>{formatByteRate(max * (2 / 3))}</text>}
        {index === 2 && <text className="chart-axis-label" x={PADDING_X - 8} y={y + 4}>{formatByteRate(max / 3)}</text>}
      </g>;
    })}
    <line className="chart-axis-line" x1={PADDING_X} x2={PADDING_X} y1={PADDING_Y} y2={HEIGHT - PADDING_Y} />
    <line className="chart-axis-line" x1={PADDING_X} x2={WIDTH - PADDING_X} y1={HEIGHT - PADDING_Y} y2={HEIGHT - PADDING_Y} />
  </>;
}

function linePoints(samples: TrafficSample[], key: 'rxBytesPerSecond' | 'txBytesPerSecond', max: number): string {
  return samples.map((_, index) => {
    const point = pointAt(samples, key, max, index);
    return point ? `${point.x.toFixed(2)},${point.y.toFixed(2)}` : '';
  }).filter(Boolean).join(' ');
}

function areaPoints(points: string): string {
  if (!points) return '';
  return `${PADDING_X},${HEIGHT - PADDING_Y} ${points} ${WIDTH - PADDING_X},${HEIGHT - PADDING_Y}`;
}

function pointAt(samples: TrafficSample[], key: 'rxBytesPerSecond' | 'txBytesPerSecond', max: number, index: number): { x: number; y: number } | null {
  const sample = samples[index];
  if (!sample) return null;
  const xStep = samples.length <= 1 ? 0 : (WIDTH - PADDING_X * 2) / (samples.length - 1);
  const x = PADDING_X + index * xStep;
  const y = HEIGHT - PADDING_Y - (Math.max(0, sample[key]) / max) * (HEIGHT - PADDING_Y * 2);
  return { x, y };
}

function trafficScale(samples: TrafficSample[]): { max: number } {
  const peak = Math.max(1, ...samples.flatMap((sample) => [sample.rxBytesPerSecond, sample.txBytesPerSecond]));
  return { max: niceRateCeiling(peak) };
}

function niceRateCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 1) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const normalized = value / base;
  const step = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * base;
}

function formatTime(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
