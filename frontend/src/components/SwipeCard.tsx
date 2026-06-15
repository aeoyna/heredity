import React from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import type { PanInfo } from 'framer-motion';

interface SwipeCardProps {
  children: React.ReactNode;
  onSwipe: (direction: 'like' | 'nope') => void;
  isActive: boolean;
  onTap?: () => void;
}

export const SwipeCard: React.FC<SwipeCardProps> = ({ children, onSwipe, isActive, onTap }) => {
  // Motion values for tracking drag position
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Map horizontal position to rotation and opacity
  const rotate = useTransform(x, [-200, 200], [-30, 30]);
  const opacity = useTransform(x, [-200, -150, 0, 150, 200], [0.5, 0.8, 1, 0.8, 0.5]);

  // Map opacity for LIKE / NOPE badges
  const likeOpacity = useTransform(x, [0, 100], [0, 1]);
  const nopeOpacity = useTransform(x, [-100, 0], [1, 0]);

  const handleDragEnd = (_event: any, info: PanInfo) => {
    if (!isActive) return;

    const swipeThreshold = 140; // threshold in pixels to register a swipe
    if (info.offset.x > swipeThreshold) {
      onSwipe('like');
    } else if (info.offset.x < -swipeThreshold) {
      onSwipe('nope');
    }
  };

  if (!isActive) {
    // Return a static stacked card behind the active one
    return (
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none select-none">
        <div className="w-full h-full rounded-2xl bg-gray-900 border border-gray-800 overflow-hidden">
          <div className="w-full h-full opacity-40 blur-[1px]">
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      style={{ x, y, rotate, opacity }}
      drag={isActive}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      whileDrag={{ scale: 1.05 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      onTap={() => {
        if (isActive && onTap) {
          // Verify that the card was not dragged.
          // x and y track the translation offsets. If they are larger than 10px, it is a drag, not a tap.
          const dragX = Math.abs(x.get());
          const dragY = Math.abs(y.get());
          if (dragX < 10 && dragY < 10) {
            onTap();
          }
        }
      }}
      className="absolute top-0 left-0 w-full h-full cursor-grab active:cursor-grabbing select-none touch-none"
    >
      <div className="w-full h-full rounded-2xl bg-gray-900 border border-gray-800 shadow-2xl overflow-hidden relative backdrop-blur-md">
        {/* Swiping Badges */}
        <motion.div 
          style={{ opacity: likeOpacity }}
          className="absolute top-8 left-8 border-4 border-emerald-500 text-emerald-500 font-extrabold uppercase px-4 py-2 rounded-lg text-3xl rotate-[-12deg] z-50 pointer-events-none select-none shadow-md backdrop-blur-sm"
        >
          LIKE
        </motion.div>

        <motion.div 
          style={{ opacity: nopeOpacity }}
          className="absolute top-8 right-8 border-4 border-rose-500 text-rose-500 font-extrabold uppercase px-4 py-2 rounded-lg text-3xl rotate-[12deg] z-50 pointer-events-none select-none shadow-md backdrop-blur-sm"
        >
          NOPE
        </motion.div>

        {children}
      </div>
    </motion.div>
  );
};
