import Phaser from 'phaser';
import { GameScene } from './GameScene';
import './styles.css';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 800,
  height: 600,
  scene: GameScene,
  backgroundColor: '#14231d',
  render: {
    antialias: false,
    pixelArt: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
});
