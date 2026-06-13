// NAT type Chinese descriptions
export const NAT_TYPE_DESCRIPTIONS: Record<string, string> = {
  'Unknown': '未知',
  'OpenInternet': '开放型互联网',
  'NoPAT': '无端口转换',
  'FullCone': '完全圆锥型 NAT',
  'Restricted': '受限圆锥型 NAT',
  'PortRestricted': '端口受限圆锥型 NAT',
  'Symmetric': '对称型 NAT',
  'SymUdpFirewall': '对称型防火墙',
  'SymmetricEasyInc': '对称型递增 NAT',
  'SymmetricEasyDec': '对称型递减 NAT',
};

export function getNatDescription(natType: string | null | undefined): string {
  if (!natType) return '';
  return NAT_TYPE_DESCRIPTIONS[natType] || natType;
}
