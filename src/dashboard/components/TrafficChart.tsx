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
const PADDING = 24;

export function TrafficChart({ traffic, t }: TrafficChartProps) {
  const samples = traffic?.samples ?? [];
  const latest = samples.at(-1);

  return <LayerCard>
    <LayerCard.Secondary>
      {t('overview.trafficChart')} {latest ? <Badge variant="outline">{latest.timestamp}</Badge> : null}
    </LayerCard.Secondary>
    <LayerCard.Primary>
      <div className="stack compact">
        <Text as="p" variant="secondary" size="sm">{t('overview.trafficChartHelp')}</Text>
        {samples.length < 2
          ? <Empty title={t('overview.noTrafficTitle')} description={t('overview.noTrafficDescription')} />
          : <div className="traffic-chart" role="img" aria-label={t('overview.trafficChart')}>
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
              <GridLines />
              <polyline className="traffic-line rx" points={linePoints(samples, 'rxBytesPerSecond')} />
              <polyline className="traffic-line tx" points={linePoints(samples, 'txBytesPerSecond')} />
            </svg>
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

function GridLines() {
  return <>
    {[0, 1, 2, 3].map((index) => {
      const y = PADDING + (index * (HEIGHT - PADDING * 2)) / 3;
      return <line key={index} className="chart-grid-line" x1={PADDING} x2={WIDTH - PADDING} y1={y} y2={y} />;
    })}
  </>;
}

function linePoints(samples: TrafficSample[], key: 'rxBytesPerSecond' | 'txBytesPerSecond'): string {
  const max = Math.max(1, ...samples.flatMap((sample) => [sample.rxBytesPerSecond, sample.txBytesPerSecond]));
  const xStep = samples.length <= 1 ? 0 : (WIDTH - PADDING * 2) / (samples.length - 1);
  return samples.map((sample, index) => {
    const x = PADDING + index * xStep;
    const y = HEIGHT - PADDING - (Math.max(0, sample[key]) / max) * (HEIGHT - PADDING * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}
