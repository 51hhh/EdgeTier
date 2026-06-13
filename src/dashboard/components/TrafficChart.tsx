import React, { useMemo } from 'react';
import { LineChart } from 'echarts/charts';
import { BrushComponent, GridComponent, ToolboxComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { Badge, ChartLegend, ChartPalette, Empty, LayerCard, Text, TimeseriesChart } from '@cloudflare/kumo';
import type { TrafficSample, TrafficSnapshot } from '../../observer/types';
import { formatByteRate, formatPercent } from '../format';
import type { Translator } from '../i18n';

interface TrafficChartProps {
  traffic?: TrafficSnapshot | null;
  t: Translator;
}

echarts.use([LineChart, GridComponent, TooltipComponent, BrushComponent, ToolboxComponent, CanvasRenderer]);

const RX_COLOR = ChartPalette.categorical(0);
const TX_COLOR = ChartPalette.semantic('Success');
const NEUTRAL_COLOR = ChartPalette.semantic('Neutral');
const ATTENTION_COLOR = ChartPalette.semantic('Attention');

export function TrafficChart({ traffic, t }: TrafficChartProps) {
  const samples = traffic?.samples ?? [];
  const chartSamples = samples.slice(-60);
  const latest = samples.at(-1);
  const scale = trafficScale(chartSamples);
  const relayDropRate = traffic?.summary.relayDropRate ?? 0;
  const chartData = useMemo(() => [
    { name: t('common.rx'), data: seriesData(chartSamples, 'rxBytesPerSecond'), color: RX_COLOR },
    { name: t('common.tx'), data: seriesData(chartSamples, 'txBytesPerSecond'), color: TX_COLOR },
  ], [chartSamples, t]);

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
              <ChartLegend.LargeItem name={t('common.rx')} color={RX_COLOR} value={formatByteRate(latest?.rxBytesPerSecond ?? 0)} />
              <ChartLegend.LargeItem name={t('common.tx')} color={TX_COLOR} value={formatByteRate(latest?.txBytesPerSecond ?? 0)} />
              <ChartLegend.LargeItem name={t('overview.trafficPeak')} color={NEUTRAL_COLOR} value={formatByteRate(scale.max)} />
              <ChartLegend.LargeItem name={t('common.relayDropRate')} color={relayDropRate > 0 ? ATTENTION_COLOR : NEUTRAL_COLOR} value={formatPercent(relayDropRate)} />
            </div>
            <TimeseriesChart
              echarts={echarts}
              data={chartData}
              height={240}
              gradient
              tooltipFollowCursor="x"
              tooltipMode="all"
              yAxisName={t('common.rate')}
              yAxisTickCount={4}
              yAxisTickFormat={formatByteRate}
              tooltipValueFormat={formatByteRate}
              xAxisTickFormat={formatTime}
              ariaDescription={`${t('overview.trafficChart')}: ${formatByteRate(scale.max)} ${t('overview.trafficScale')}`}
            />
            <div className="chart-legend">
              <ChartLegend.SmallItem name={t('common.rx')} color={RX_COLOR} value={formatByteRate(latest?.rxBytesPerSecond ?? 0)} />
              <ChartLegend.SmallItem name={t('common.tx')} color={TX_COLOR} value={formatByteRate(latest?.txBytesPerSecond ?? 0)} />
              <span>{t('overview.trafficSamples')} {chartSamples.length}</span>
              <span>{t('common.relayDropRate')} {formatPercent(traffic?.summary.relayDropRate)}</span>
            </div>
          </div>}
      </div>
    </LayerCard.Primary>
  </LayerCard>;
}

function seriesData(samples: TrafficSample[], key: 'rxBytesPerSecond' | 'txBytesPerSecond'): [number, number][] {
  return samples.flatMap((sample) => {
    const timestamp = new Date(sample.timestamp).getTime();
    return Number.isFinite(timestamp) ? [[timestamp, Math.max(0, sample[key])] as [number, number]] : [];
  });
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

function formatTime(value: number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
